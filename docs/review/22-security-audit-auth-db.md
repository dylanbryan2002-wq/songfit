# 22 — Security audit: identity, authorization, database

Date: 2026-10-08. Scope: `supabase/migrations/0001`–`0009`, `supabase/config.toml` (auth section), `src/db/client.ts`,
`src/db/browser.ts`, `src/db/queries/*`, `src/auth/*`, `app/auth/callback/route.ts`, `app/api/claim/route.ts`,
`app/api/submissions/**`, `app/api/upload-url/route.ts`, `app/api/landing-events/route.ts`, `app/api/health/route.ts`,
`app/results/**`, `app/admin/**`, `src/media/storage.ts`, `components/upload.ts`, `components/auth.ts`, `middleware.ts`.
Read-only review; nothing was executed against a database. Production dashboard settings (auth providers, rate limits)
were not visible and are called out where a finding depends on them.

Bottom line: no cross-tenant read or write was found. Every app route goes through the service-role client and does an
explicit `creator_id === viewer.id` check, and every security-definer function is revoked from `anon`/`authenticated`.
The real exposure comes from **direct Supabase API access with a normal user JWT** (the anon key is public). RLS
policies the app never uses still apply there, and anonymous sign-in makes such a JWT free to get.

## Findings

| ID | Severity | Title | Where | Exploit (one sentence) | Fix (one sentence) |
|----|----------|-------|-------|------------------------|--------------------|
| F1 | Medium | Anonymous visitors bypass the results sign-in gate through PostgREST | `0003_rls.sql:28-35`, `:16-23`, `:12-14` | An anonymous visitor runs `supabase.from('recommendations').select('*')` in devtools with their own session and gets all 15 picks with timestamps, plus `video_analyses.raw_response` and `submissions.error`, without signing in. | Drop the unused "read own" select policies on `recommendations`, `video_analyses`, `submissions` (the app reads only through the service role), or add `and not coalesce((auth.jwt()->>'is_anonymous')::boolean, false)`. |
| F2 | Medium | `creators: update own` lets a user rewrite their own `email` and `claim_token_hash`, which allows email squatting | `0003_rls.sql:9-10` + `0009_anonymous.sql:5-6,16-22` | An anonymous user PATCHes their own creators row to `email='target@gmail.com'`, and when that person later signs in with Google the `handle_new_user` insert hits `creators_email_key`, so Supabase returns "Database error saving new user" and they can never sign up. | Drop the update policy (nothing in the app uses it), or at minimum `revoke update on public.creators from authenticated` and grant only `update (display_name, preferences)`. |
| F3 | Medium | Unlimited anonymous identities can spend unlimited model money | `app/api/upload-url/route.ts:19-28`, `src/billing/rateLimit.ts:36-38`, `config.ts:26`; no CAPTCHA | A script calls `signInAnonymously()` 30 times an hour per IP (more with rotating IPs) and runs 3 pipelines per identity, about 90 full Claude+Whisper runs per hour per IP, with no global ceiling. | Turn on Supabase CAPTCHA (Turnstile) for anonymous sign-ins and add a global "anonymous submissions in the last 24 h" ceiling to `overDailyLimit`. |
| F4 | Medium | Storage insert policy lets any session upload unlimited files of any type into its own folder | `0003_rls.sql:55-57`, `0001_init.sql:300-302` (no `allowed_mime_types`) | An anonymous session uses the storage API directly (`storage.from('videos').upload('<uid>/x1.bin', ...)` in a loop) to store unlimited 150 MB objects, skipping `/api/upload-url` and every rate limit. | Set `allowed_mime_types` on the bucket, narrow the policy to `name ~ '^<uid>/[0-9a-f-]{36}\.(mp4|mov|webm|m4v)$'`, and later switch TUS to signed-upload tokens so the insert policy can be dropped. |
| F5 | Medium (Critical if the Email provider is on in prod) | Identity and admin trust any Supabase auth email, whatever the provider or confirmation state | `src/auth/session.ts:15-23,39-49`; `supabase/config.toml` `[auth.email] enable_signup = true`, `enable_confirmations = false` | If the Email provider is enabled in production with confirmations off (as in local config), anyone can `signUp({ email: <any ADMIN_EMAILS entry not yet registered>, password })`, get a session with that email immediately, and pass `requireAdmin()` to read every creator's videos and data. | In `getViewer` accept only `user.app_metadata.provider === 'google'` (or a Google identity) with `email_confirmed_at` set, and confirm the Email provider is disabled in the dashboard. |
| F6 | Low | INTERNAL_TOKEN compared with `!==`; static bearer; `run` route skips `isUuid` | `app/api/submissions/[id]/run/route.ts:11-17`, `app/api/health/route.ts:21` | In theory a timing side channel leaks the token byte by byte; in practice network jitter on Vercel makes this infeasible, and a replay only re-enters the idempotent claim. | Use `crypto.timingSafeEqual` on equal-length buffers and add `isUuid(id)` before the lookup. |
| F7 | Low | Events can be inflated or polluted | `app/api/landing-events/route.ts:22-31,58`; `app/results/[id]/page.tsx:27-30`; `events/route.ts:19` | Anyone (no session) can post `landing_viewed`/`video_chosen`/`sign_in_started` at 30/min per IP **per server instance**, and an anonymous owner logs `results_gate_viewed` on every reload, which skews the funnel used for the 100/10 goal. | Count distinct `flow_id` and distinct submission in metrics rather than rows, and log `results_gate_viewed` once per submission (same conditional-update pattern as `viewed_at`). |
| F8 | Low | Daily cap check is not atomic | `app/api/submissions/route.ts:46-60` vs `0006_paywall_off.sql:23` | N parallel `POST /api/submissions` with different pre-uploaded ids all pass `overDailyLimit` before any row exists, so a creator gets more than 3 (anon) or 10 runs. | Move the daily count into `create_submission()` under its existing advisory lock. |
| F9 | Low | `sf_claim` cookie survives a failed or abandoned sign-in for 1 h | `app/auth/callback/route.ts:41-47`, `src/auth/claim.ts:11` | On a shared phone, visitor A taps "See my songs", abandons Google, and visitor B then signs in with Google within the hour and receives A's runs. | Also clear the cookie on the `/?auth=failed` branch, and shorten `maxAge` to 10 min (the Google round trip). |
| F10 | Info | Hardening notes | various | See details. | See details. |

Counts: Critical 0 · High 0 · Medium 5 (F5 becomes Critical if the Email provider is enabled in prod) · Low 4 · Info 1.

## Details

### F1 — Anonymous visitors bypass the results gate (Medium)

The gate exists only in server rendering:

```ts
// src/auth/gate.ts:11-13
if (submission.creator_id !== viewer.id && !viewer.admin) return "not_found";
if (submission.status !== "ready") return "waiting";
return viewer.anonymous ? "gate" : "picker";
```

The database grants an anonymous session the same reads as a Google one, because Supabase anonymous users carry
role `authenticated`:

```sql
-- 0003_rls.sql:28-35
create policy "recommendations: read own" on public.recommendations
  for select to authenticated using (
    exists (select 1 from public.submissions s
            where s.id = recommendations.submission_id and s.creator_id = auth.uid()));
-- 0003_rls.sql:16-23  same shape for video_analyses (includes raw_response, prompt_version)
-- 0003_rls.sql:12-14  submissions: read own (includes the raw `error` text)
```

The anon key is public (`src/db/browser.ts:12-13`) and the session sits in the browser's cookies, so
`createBrowserClient().from('recommendations').select('*').eq('submission_id', id)` returns every pick, its start/end and
explanation. That defeats the conversion gate, which is the week's metric. It also exposes model output
(`raw_response`, `prompt_version`) and raw pipeline errors, which the product rules say creators never see. It is
**not** cross-tenant: `auth.uid()` scoping is correct.

The app never relies on these policies. `grep` finds no `.from(`/`.rpc(` in `components/` or `app/`, and every query in
`src/db/queries/*` uses `createServiceClient()`. Dropping them removes the surface at no cost:

```sql
drop policy "recommendations: read own" on public.recommendations;
drop policy "video_analyses: read own" on public.video_analyses;
drop policy "submissions: read own" on public.submissions;
-- subscriptions/creators read-own are harmless but equally unused
```

### F2 — Creators can rewrite their own `email` and `claim_token_hash` (Medium)

```sql
-- 0003_rls.sql:9-10
create policy "creators: update own" on public.creators
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
```

No migration revokes the Supabase default table grants, so `authenticated` may UPDATE every column. Since 0009,
`email` is nullable and unique (`0009_anonymous.sql:5`) and `claim_token_hash` is new (`:6`). Consequences:

1. **Targeted sign-up denial (real).** An anonymous session runs `PATCH /rest/v1/creators?id=eq.<own id>` with
   `{"email":"influencer@gmail.com"}`. Later, when that person first signs in with Google, the trigger runs
   ```sql
   -- 0009_anonymous.sql:16-22
   insert into public.creators (id, email, display_name) values (new.id, new.email, ...)
   on conflict (id) do nothing;      -- only an id conflict is absorbed
   ```
   This raises `unique_violation` on `email`, which aborts the `auth.users` insert, so that person can never create an
   account. `ensureCreator` (`src/db/queries/creators.ts:24-31`) would fail the same way. This only works for emails
   not yet registered, which describes exactly the 100 creators being recruited this week.
2. **Admin queue spoofing.** `listSubmissions` shows `creator.email` (`app/admin/page.tsx:34`), so an anonymous run can
   appear as any chosen address. It also flips that row into "counts as a creator" in `metrics_summary`
   (`0009_anonymous.sql:76,110-111`).
3. `claim_token_hash` is writable too, but only on the caller's own row. It can only make the caller's own runs
   claimable by whoever holds the preimage. No theft path was found (see "What is solid").

Fix: `drop policy "creators: update own" on public.creators;` (nothing in the app writes creators except through the
service role). Optionally also `revoke insert, update, delete on all tables in schema public from anon, authenticated;`
so a future accidental policy can't reopen writes.

### F3 — Unbounded anonymous spend (Medium)

```ts
// app/api/upload-url/route.ts:19-28
const creator = await getViewer();               // anonymous accepted
const rate = await checkUploadRate(creator.id, dailyUploadLimit(creator.anonymous)); // 3 per uid per 24 h
```

Every cap is keyed on the auth uid, and a new uid costs one `signInAnonymously()` call. The only per-IP limit is
Supabase's anonymous sign-in limit (30/h default, `config.toml` `anonymous_users = 30`). `docs/review/17` planned to
lower it to 10/h, and that dashboard setting could not be verified. No CAPTCHA is configured (`config.toml`
`# [auth.captcha]`, and no Turnstile anywhere in `app/` or `components/`). Each run makes several Claude calls with up to
60 frames, plus Whisper. Plan 17 accepted this risk (`docs/review/17-anonymous-upload-plan.md:158`). It is listed here
because there is no global ceiling, so one person with a few IPs can burn the month's model budget overnight.

Fix (cheap, no new infra): Supabase Auth → Bot and Abuse Protection → Turnstile (one site key in the landing page, one
secret entered by Dylan in the dashboard). Also add a global ceiling: one `count(*)` of submissions by `email is null`
creators in the last 24 h, checked in `overDailyLimit` for anonymous viewers.

### F4 — Direct storage uploads bypass the app (Medium)

```sql
-- 0003_rls.sql:55-57
create policy "videos: upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
-- 0001_init.sql:300-302: bucket private, file_size_limit 150 MB, no allowed_mime_types
```

The policy exists because files over 6 MB go through TUS with the user's JWT (`components/upload.ts:37-56`). It does not
bind the object to an issued submission id, an extension or a content type. Any session (including a fresh anonymous
one) can upload unlimited objects of up to 150 MB each, of any type, without calling `/api/upload-url`. That skips
`checkUploadRate` entirely. The objects are never cleaned up, so the cost is storage spend and quota exhaustion.
Overwrites are **not** possible: there is no UPDATE policy, and both upload paths send `x-upsert: false`.

The signed upload URL (`src/media/storage.ts:24-26`) is bound to the exact path `<creator>/<uuid>.<ext>` (good). It is
not bound to size or type, because Supabase signed upload URLs can't be, and it stays valid for 2 h by Supabase default.
`POST /api/submissions` re-checks size afterwards (`route.ts:49-51`) but not content type.

Fix: in a new migration, `update storage.buckets set allowed_mime_types = '{video/mp4,video/quicktime,video/webm,video/x-m4v}' where id='videos'`
and tighten the policy's `with check` to
`name ~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(mp4|mov|webm|m4v)$')`. Later, switch TUS to the signed-upload
token (`x-signature` header, supported by Supabase resumable uploads) and drop the insert policy.

### F5 — Identity trusts any Supabase auth email (Medium; Critical if the Email provider is on)

```ts
// src/auth/session.ts:15-23
if (data.user.is_anonymous) return { id: data.user.id, anonymous: true, email: null };
if (!data.user.email) return null;
...
return { id: data.user.id, anonymous: false, email: data.user.email };
// :39-42
if (!creator || !isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "")) redirect("/");
```

Neither the provider nor `email_confirmed_at` is checked. The project's local `supabase/config.toml` has
`[auth.email] enable_signup = true` and `enable_confirmations = false`. If production matches, `signUp` with
email+password returns a session immediately for **any unregistered address**. That is a direct admin takeover if any
`ADMIN_EMAILS` entry has never signed in with Google, and it lets anyone impersonate not-yet-registered creators. With
the Email provider off in the dashboard (likely, since CLAUDE.md bans password auth), this is not exploitable today.
The code should still not depend on a dashboard toggle.

`isAdminEmail` itself is fine. It trims and lower-cases both sides, rejects null and empty, and uses exact list
membership (`src/auth/admin.ts:1-10`), so an anonymous viewer (email null) can never pass `isAdmin`/`requireAdmin`.

Fix: in `getViewer`, return null unless `data.user.app_metadata?.provider === "google"` (or
`data.user.identities?.some(i => i.provider === "google")`) **and** `data.user.email_confirmed_at`. Then check the
dashboard: Authentication → Providers → Email is disabled.

### F6 — Internal token comparison (Low)

```ts
// app/api/submissions/[id]/run/route.ts:11-12
const token = request.headers.get("x-internal-token");
if (!token || token !== env("INTERNAL_TOKEN")) { ... 403 }
// app/api/health/route.ts:21  same comparison, wrapped so an unset token never honours ?sleep
```

String `!==` is not constant-time. Over the internet through Vercel's edge, the jitter makes a timing attack
impractical. Replaying a captured token re-runs `runSubmission`, which is guarded by `claim_submission_run` (never
touches `ready`, refuses an in-flight row younger than 6 min), so the damage is bounded. `env()` throws on an unset or
empty value (`src/shared/config.ts:66-71`), so an empty token can't match. The route also skips `isUuid(id)` before
`getSubmission` (500 instead of 404). Fix with `timingSafeEqual` and `isUuid`.

### F7 — Event pollution (Low)

`/api/landing-events` accepts unauthenticated writes. Its limiter is a per-instance in-memory map keyed on
`x-forwarded-for` (`route.ts:22-31`), so it doesn't hold across Vercel instances. `results_gate_viewed` is logged on
every render of a gated page (`app/results/[id]/page.tsx:27-30`). Anyone can inflate the landing funnel, and an
anonymous user can inflate gate views. Events cannot be written for **another** creator's submission: every
submission-scoped event route checks ownership first (`events/route.ts:33-36`, `feedback/route.ts:21-24`), and the
`events` table has no client policy (`0003_rls.sql:37-38`).

PII in payloads: `wanted_instead.text` (≤ 200 chars free text, `events/route.ts:19`) and `submissions.creator_intent`
can hold whatever the creator types. No email, filename, size or IP is written to events (landing body is
`.strict()` to `{name, flow_id}`, `landing-events/route.ts:14-19`). The privacy page should mention free-text feedback.

### F8 — Non-atomic daily cap (Low)

`overDailyLimit` (`route.ts:46`) counts rows, then `createSubmission` inserts later (`:55`). The advisory lock in
`create_submission` (`0006:23`) only guards the 1000-run paywall count. Parallel posts can exceed 3/10 per day by the
level of concurrency. Moving the 24 h count into `create_submission` fixes it atomically.

### F9 — Claim cookie lifetime (Low)

The cookie is set correctly (`httpOnly`, `secure`, `sameSite: lax`, `path=/`, 1 h; `src/auth/claim.ts:6-12`) and cleared
on the success path (`callback/route.ts:43`). On the failure path (`:47`) it is left in place, and an abandoned Google
round trip also leaves it, so it can attach the runs to whichever Google account signs in next on that browser within
the hour. This only matters on shared devices. Fix: clear it on `:47` too and use `maxAge: 600`.

### F10 — Info / hardening

- RLS is **enabled** on all 11 public tables but not **forced** (`alter table ... force row level security` is
  absent). Only the table owner (`postgres`) bypasses unforced RLS, and `service_role` has `BYPASSRLS` anyway. No action.
- Default Supabase grants give `anon`/`authenticated` full DML on public tables. RLS denies everything without a
  policy, but a revoke of insert/update/delete (see F2) is cheap insurance.
- Signed playback URLs last 1 h (`app/results/[id]/page.tsx:34`, `storage.ts:61`). They are bearer links, so a forwarded
  results link plays the video for an hour. Acceptable; 15 min would be enough for a page view.
- Anonymous `auth.users`/`creators` rows and their storage objects are never deleted (the claim keeps files under
  `<anon-id>/`). Plan a cleanup before the privacy page promises deletion.
- `GET /api/health?binaries=1` is public and returns server file paths. Harmless, but it could sit behind the internal token.
- `getViewer` and `getCreator` are called per request and upsert `creators` for Google users on every call
  (`session.ts:18-22`). Not a security issue, just one write per request.

## What is solid (verified)

- **No cross-tenant access through the app.** Every route resolves the session server-side with `auth.getUser()`
  (`session.ts:12`, which validates with Supabase and does not trust a decoded cookie), then compares
  `submission.creator_id` to the viewer id before doing anything: `submissions/[id]/route.ts:34`,
  `retry/route.ts:25`, `feedback/route.ts:23`, `events/route.ts:35`, `preview/[rank]/route.ts:22`,
  `results/[id]/page.tsx:25` via `gate.ts:11`, `submissions/route.ts:38`. No route accepts a client-supplied
  `creator_id`, and the creator id always comes from the session.
- **Upload path binding.** The server picks the submission id (`upload-url/route.ts:33`) and the path
  `<creator>/<uuid>.<ext>` with an enum ext. `POST /api/submissions` requires exact string equality with the path
  rebuilt from the session (`storage.ts:13-15`, `submissions/route.ts:43`), and `create_submission` refuses an existing
  id owned by someone else (`0006:28-30`).
- **Service-role use is server-only.** `src/db/client.ts:1` imports `server-only`, and the browser client uses only the
  anon key (`browser.ts:12-13`). Every `createServiceClient()` call site is in `src/db/queries/*` or `src/media/storage.ts`.
  Every request-reachable caller is either admin-gated (`requireAdmin` in `admin/layout.tsx:7`, `admin/page.tsx:9`,
  `admin/submissions/[id]/page.tsx:27`, `actions.ts:14`, `admin/metrics/page.tsx:18`, each page gating itself),
  ownership-checked as above, token-gated (`run/route.ts:12`), or writes only the caller's own row
  (`setClaimTokenHash(viewer.id)`, `claim/route.ts:15`).
- **Security-definer functions are locked down.** `create_submission`, `claim_submission_run`,
  `set_recommendation_feedback` (`0001:292-297`), `exec_sql` and `metrics_summary` (`0004:5-6,73-74`, `0009:127-128`),
  and `claim_anonymous` (`0009:54-55`) are revoked from `public, anon, authenticated` and granted only to
  `service_role`. All set `search_path = public`. `exec_sql` (arbitrary SQL) is therefore not callable from the client.
- **`claim_anonymous` is sound.** Only the service role can execute it. The token is 32 random bytes
  (`claim.ts:14-16`) and only its SHA-256 is stored, so a guessed or known hash is useless without the cookie preimage,
  and the database can't leak a usable token. Equality on a 256-bit hash makes timing irrelevant. `for update` plus
  nulling the hash makes a concurrent or repeated call return 0, because under READ COMMITTED the waiting `select ... for
  update` re-checks `claim_token_hash = p` on the new row version and finds null. `email is null and id <> p_creator_id`
  stops it moving rows out of a Google account or into itself. The target id is the session's own id
  (`callback/route.ts:34`), never client input.
- **Login CSRF into an attacker's account is blocked.** `@supabase/ssr` uses the PKCE flow, so a forged
  `/auth/callback?code=<attacker code>` fails without the victim browser's code verifier. That rules out the "trick a
  victim into claiming their runs into my account" attack. Code exchange errors fall through to `/?auth=failed`
  (`callback/route.ts:17,47`).
- **`next` redirect is safe.** `safeNext` (`src/auth/redirect.ts:2-11`) resolves against the request origin and requires
  the same origin with a path starting with `/` and not `//`. `//evil.com` resolves to another origin and is rejected.
  `/\evil.com` is normalised by the WHATWG parser to `//evil.com` and rejected. `javascript:` has origin `null` and is
  rejected.
- **Anonymous restrictions hold server-side.** `getCreator()` returns null for anonymous sessions (`session.ts:27-30`),
  so retry, feedback, UI events, preview and `/results/latest` reject them. The gate page issues no playback URL and
  loads no picker data for them (`results/[id]/page.tsx:32-35`). Only `/api/claim` requires anonymous
  (`claim/route.ts:12`).
- **No one can read another creator's `email` or `claim_token_hash`.** `creators: read own` is `auth.uid() = id`
  (`0003:7-8`). The only cross-creator email read is the admin queue (`submissions.ts:122-129`), which is admin-gated.
- **Storage bucket is private** (`0001:300-302`, `public = false`). Read and insert are scoped to
  `foldername(name)[1] = auth.uid()`. There are no UPDATE/DELETE policies, so users can't overwrite or delete, even their
  own files.
- **`handle_new_user` cannot be steered to a chosen id.** The id comes from GoTrue, and the email is Google-verified or
  null for anonymous users (F5 covers the email-provider caveat). Trigger functions can't be invoked through RPC.
- **The claim cookie is set and cleared correctly** on the success path, with the same attributes (`claim.ts:6-12`,
  `callback/route.ts:43`).

## Prioritised fix list

1. **F5**: today, check Supabase Dashboard → Authentication → Providers → Email is **disabled**. Then add the
   `provider === 'google' && email_confirmed_at` check in `getViewer` (3 lines).
2. **F1 + F2**: one migration `0010_tighten_rls.sql`: drop `recommendations/video_analyses/submissions: read own` and
   `creators: update own`, and revoke insert/update/delete on public tables from `anon, authenticated`. Update
   `docs/DATA_MODEL.md` RLS lines first. No app code changes needed.
3. **F3**: enable Turnstile CAPTCHA for anonymous sign-ins (Dylan enters the secret in the dashboard), lower anonymous
   sign-ins to 10/h as plan 17 intended, and add a global 24 h ceiling for anonymous runs.
4. **F4**: same migration: set `allowed_mime_types` on `videos` and tighten the insert policy's path regex.
5. **F8**: move the daily count into `create_submission` (needs Dylan's OK, since the function enforces the paywall).
6. **F9, F6, F7**: clear `sf_claim` on the failure branch with a 10 min lifetime, `timingSafeEqual` + `isUuid` in the
   internal routes, and log `results_gate_viewed` once per submission.
