# 22 · Security audit: browser side, secrets, privacy, operations

Date: 2026-10-08 · Branch `mvp` · Auditor: Claude (read-only, nothing edited except this file)
Scope: client bundle and secret handling, browser storage, third-party origins, personal data and
privacy page, admin surface, operational kill switches and spend, the secrets guard hook.
Server route authorization in depth is someone else's surface; it is touched here only where it
changes what personal data can leak.

Counts: **Critical 0 · High 3 · Medium 5 · Low 5 · Info 4**

---

## Findings table

| ID | Sev | Title | File:line | Scenario | Fix |
|----|-----|-------|-----------|----------|-----|
| H1 | High | Any visitor can rewrite their own `creators` row (email, claim hash) | `supabase/migrations/0003_rls.sql:9-10`, `0001_init.sql:7`, `0009_anonymous.sql:15-22` | Anonymous visitor uses the public anon key + their JWT: `PATCH /rest/v1/creators?id=eq.<self> {"email":"victim@gmail.com"}`. The victim's later Google sign-up then fails (unique email; trigger only handles `on conflict (id)`). Any non-null email also makes the anonymous row count as a "creator" in `metrics_summary` (pitch numbers) and shows a spoofed email in `/admin`. | Migration 0010: `drop policy "creators: update own" on public.creators;` (no code uses it; all writes go through the service role). |
| H2 | High | No ceiling on AI spend from anonymous visitors | `src/shared/config.ts:25-26`, `src/billing/rateLimit.ts:36-43`, `docs/RUNBOOK.md:44-46` | Caps are per creator id. Anonymous sign-in mints a new id per call (Supabase default ~30/h per IP), each gets 3 runs/24 h plus 3 retries. One IP: ~90 runs/h at ~$0.34+ each; rotating IPs: unbounded. No global daily cap, no captcha, kill switches are code constants (commit + push + ~2 min deploy), and no Anthropic/OpenAI spend limit is recorded as set. | (1) Today, in dashboards: hard monthly spend limits on Anthropic and OpenAI; lower the anonymous sign-in rate limit. (2) Code: one global "runs started in last 24 h" check in `create_submission` (or `/api/upload-url`) that returns the daily-limit message; make it an env var so Vercel can change it without a commit. (3) Captcha on anonymous sign-in if abuse appears. |
| H3 | High | "We will delete your videos" has no working path; nothing ever expires | `app/privacy/page.tsx:57-61`, `src/media/storage.ts:8-10`, `0009_anonymous.sql:46-48` | Deleting the auth user cascades table rows but **not Storage objects** (originals + `.playback.mp4`). Runs claimed from an anonymous session keep their files under the **anonymous id's folder**, so deleting `videos/<google_id>/` misses them. `events.metadata` (incl. `wanted_instead` free text) survives with `creator_id = null`. Abandoned anonymous runs and anonymous auth users are kept forever. | Add a "Delete a creator" runbook section (SQL to list every `video_path`/`playback_path` for the creator, delete those objects, then delete the auth user, then null `wanted_instead` text). Add a manual monthly purge for unclaimed anonymous runs older than 30 days and say so on the privacy page. |
| M1 | Medium | Storage insert policy lets any session upload arbitrary files | `0003_rls.sql:55-60`, `0001_init.sql:300-302`, `components/upload.ts:50-60` | Any authenticated user, anonymous included, can upload unlimited objects of any type (≤150 MB each) to `videos/<uid>/…` with any name, and read them back via signed URLs: free file hosting for abusive content on Songfit's project, plus storage cost. Orphans (no submission row) are never cleaned. | Set `allowed_mime_types` on the bucket to video types. Tighten the policy's `with check` to `name ~ '^<uid>/[0-9a-f-]{36}\.(mp4|mov|webm|m4v)$'`, or switch TUS to the signed-upload token (`x-signature` header) and drop the insert policy entirely. Periodically list objects without a submission row. |
| M2 | Medium | Admin = any session whose auth email matches, regardless of provider | `src/auth/session.ts:41,48` | Safe only while Google is the only provider that sets an email and email confirmation is on. If the Email provider is enabled with "Confirm email" off, anyone can sign up as `dylanbryan2002@gmail.com`, or an anonymous user can `updateUser({email})`, and get `/admin` (every creator's email, videos, transcripts). | Dashboard: disable the Email provider (see checklist). Code: in `isAdmin`/`requireAdmin`, also require `user.app_metadata.provider === "google"` and `email_confirmed_at`. |
| M3 | Medium | Privacy page omits or contradicts several facts | `app/privacy/page.tsx:27-61` | See details: on-device copy can outlive "30 minutes"; operator can view videos/transcripts; speech transcripts stored; anonymous uploads; AI-provider retention; no controller/legal basis/transfer/age wording; IPs in Supabase/Vercel logs; browser fetches Deezer directly. | Rewrite per the "Privacy page" section below (copy is drafted there). |
| M4 | Medium | Self-heal restart has no cap | `app/api/submissions/[id]/route.ts:39-42`, `app/api/submissions/[id]/retry/route.ts:31` | A video that gets the function killed (OOM, platform timeout) never writes `pipeline_failed`, so the retry cap never trips. Every poll after 6 min restarts it, as long as a tab is open; each restart re-pays Whisper/Claude for the stage. | Count restarts (write a `pipeline_failed` event with `stage: "stale"` on each stale restart, or a counter column) and stop self-healing after 2; the creator then sees Try again / Try another video. |
| M5 | Medium | Secrets guard has realistic gaps | `.claude/settings.json` (matcher), `.claude/hooks/guard-secrets.py:15-23,50-76`, `package.json` scripts | (a) Matcher covers only Bash/Edit/Write/MultiEdit/Read/NotebookEdit/Grep/Glob: the Artifact publish `file_path`, IDE `executeCode`, browser `file_upload` and other MCP tools are unchecked. (b) A recursive content search (`grep -rn ANTHROPIC_API_KEY .`, Grep tool on `.`) reads the env file without naming it. (c) The Vercel regex misses flags that take a separate value: `vercel --cwd . link`, `vercel --scope x env pull`. (d) `pnpm smoke`, `pnpm local`, `pnpm db:*` load the env file by name from `package.json`, so a Bash call never mentions it. (e) Fails open on malformed input, missing python3 or a 10 s timeout. | Strongest single fix: keep the secrets file **outside the repo** (e.g. `~/.config/songfit/secrets`, referenced by path in `package.json`), so no recursive tool in the repo can see it. Then: matcher `.*` and scan every string field of `tool_input`; Vercel regex `\b(vercel|vc)\b[^|;&]*\b(link|pull)\b`. |
| L1 | Low | No security headers; auth cookies are JS-readable | `next.config.ts:8-24` | No CSP, `frame-ancestors`/X-Frame-Options, Referrer-Policy, Permissions-Policy or nosniff. `@supabase/ssr` sets `sb-*-auth-token` with `httpOnly: false`, 400-day max-age (library default), so any future XSS = session theft. No XSS sink found today (no `dangerouslySetInnerHTML`, React 19 escapes). | Add a `headers()` block: `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. CSP later (needs Supabase + Deezer CDN hosts). |
| L2 | Low | The anonymous results gate is UX, not a boundary | `0003_rls.sql:29-35,58-60`, `src/auth/gate.ts:13` | An anonymous session can read its own `recommendations` through PostgREST and sign its own video URL, skipping Google sign-in. Own data only, so no privacy leak; it only weakens the sign-in conversion step. | Accept for launch. If it matters: drop the authenticated select policies on `recommendations` (the app reads them with the service role). |
| L3 | Low | Raw pipeline error readable by the owner | `src/pipeline/run.ts:101`, `0003_rls.sql:13-14` | `/api/submissions/[id]` hides `submissions.error`, but the owner can select the column directly via PostgREST (model error text, internal stage names). No secrets are put in it (Whisper errors go through `safeMessage`). | Accept, or revoke column select: `revoke select (error) on public.submissions from authenticated`. |
| L4 | Low | tus-js-client keeps upload fingerprints in localStorage | `components/upload.ts:50` | For files >6 MB, `tus::…` entries (upload URL, object path `<creator_id>/<submission_id>.ext`) are removed only on success; a failed upload leaves them after sign-out on a shared phone. No video data. | `signOut()` could clear keys starting with `tus::`. Optional. |
| L5 | Low | Ignore rules and docs still invite a stray key file | `.gitignore:4-6`, `.env.example` (Apple block), `README.md` (Apple env row) | `.gitignore` covers `.env`, `.env.local`, `.env*.local`, `.vercel`, `tmp/`, but not `.env.production`, `.env.development`, `*.p8`, `AuthKey_*`. Apple is withdrawn (RESEARCH.md) yet the template still asks for a `.p8` path. **History check: no `.p8`, AuthKey, PEM or real key was ever committed** (see "What is solid"). | Add `.env.*` + `!.env.example`, `*.p8`, `*.pem` to `.gitignore`; drop the Apple block from `.env.example` and README. |
| I1 | Info | Token compare and health endpoint | `app/api/submissions/[id]/run/route.ts:12`, `app/api/health/route.ts:18-40` | `INTERNAL_TOKEN` compared with `===` (timing side channel is impractical over the network). `/api/health?binaries=1` is public and returns server file paths. | `crypto.timingSafeEqual`; gate `binaries` behind the token. |
| I2 | Info | Browser talks to Deezer CDN directly | `components/picker/SongRow.tsx:162`, `components/picker/useSyncedPlayback.ts:163` | Viewer IP + `Referer: https://thissongfits.com/` (origin only under the browser default) reach Deezer. Expected; mention it in the privacy page. | Optional `referrerPolicy="no-referrer"` on artwork and audio. |
| I3 | Info | Guard false positive pushes agents toward workarounds | `guard-secrets.py:15` | `grep "process.env"` is blocked (the regex sees `.env`). An auditor has to grep for `process\.` instead. | Allow `process.env` explicitly in `probe` the same way `.env.example` is stripped. |
| I4 | Info | Framework versions | `node_modules` | next 15.5.27, react 19.1.0, @supabase/ssr 0.5.2, tus-js-client 4.3.1. Not affected by the 2025 middleware-bypass CVE, and middleware does no auth anyway (only session refresh). | None. |

---

## Details

### H1: `creators` update policy

```sql
-- supabase/migrations/0003_rls.sql:9-10
create policy "creators: update own" on public.creators
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
```
No column restriction, and Supabase grants `update` on all columns to `authenticated` by default.
`creators.email` is `text unique` (0001:7, nullable since 0009). The signup trigger handles only an
id conflict:
```sql
-- 0009_anonymous.sql:15-22
insert into public.creators (id, email, display_name) values (new.id, new.email, ...)
on conflict (id) do nothing;
```
So a squatted email makes `auth.users` insert fail for that person ("Database error saving new user").
`metrics_summary()` counts a creator when `creators.email is not null` (DATA_MODEL, 0009), so
self-set emails inflate "distinct creators", the number the pitch rests on. Admin authorization
is **not** affected (it reads the auth email, not `creators.email`). Nothing in the app writes
`creators` with the user's JWT (`src/db/queries/creators.ts` uses only `createServiceClient()`),
so dropping the policy changes no behaviour.

### H2: spend ceiling

```ts
// src/shared/config.ts:25-26
dailyUploadsPerCreator: 10, // spend cap: submissions created per rolling 24 h
dailyUploadsAnonymous: 3, // same cap before Google sign-in (anonymous session)
```
```ts
// src/billing/rateLimit.ts:41-42
export async function overDailyLimit(creatorId: string, limit: number, now = Date.now()) {
  return (await countSubmissionsSince(creatorId, ...)) >= limit;
```
The cap is keyed by `creatorId`, and an anonymous id costs one `signInAnonymously()` call. The burst
limiter (`takeToken`) is per instance and also per creator. RUNBOOK's levers:
"`PREVIEWS_ENABLED` … Change, commit, push; Vercel redeploys in ~2 minutes" and "raise the number
in `src/shared/config.ts` and redeploy". There is no lever that stops new runs in under a minute
without a deploy. Today's fastest emergency stop: disable Anonymous sign-ins in Supabase (anonymous
visitors fall back to Google, by design in `ensureAnonSession`), and/or revoke the Anthropic key.
Write both into RUNBOOK.

### H3: deletion and retention

Privacy page, lines 59-60: "Email {CONTACT} and we will delete your videos, your results, and your
account within a few days." What actually happens on each delete path:
- `auth.users` delete → `creators` (0001:6 cascade) → `submissions` cascade → `video_analyses`,
  `candidates`, `recommendations` cascade; `subscriptions` cascade; `events.creator_id` and
  `events.submission_id` **set null**, so rows and metadata stay.
- Storage has no FK. `videos/<creator>/<submission>.<ext>` and `.playback.mp4` stay.
- `claim_anonymous()` moves rows only (`update public.submissions set creator_id = p_creator_id`);
  `video_path` still begins with the **anonymous** id, so the files sit in a folder that is not
  the Google creator's.
- No code anywhere deletes Storage objects (the only `.remove(` is in `scripts/probe-upload-limit.ts`).

Runbook draft (Supabase SQL editor, then Storage):
```sql
-- 1. every file for this creator, whichever folder it is in
select video_path, playback_path from submissions where creator_id = '<id>';
-- 2. delete those objects in Storage → videos (or storage API remove([...]))
-- 3. scrub free text that survives the cascade
update events set metadata = metadata - 'text' where creator_id = '<id>' and name = 'wanted_instead';
-- 4. Authentication → Users → delete user (cascades the rest). Also delete the anonymous
--    user(s) the creator came from, if known (their emptied creators row stays otherwise).
```

### M1: storage policy

```sql
-- 0003_rls.sql:55-57
create policy "videos: upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
```
Bucket created with only `file_size_limit` (0001:300-302), no `allowed_mime_types`. The policy is
needed today only because the TUS path authenticates with the user's bearer token
(`components/upload.ts:52`). Small files already use the server-issued signed URL.

### M2: admin check

```ts
// src/auth/session.ts:39-44
export async function requireAdmin(): Promise<Creator> {
  const creator = await getCreator();
  if (!creator || !isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "")) redirect("/");
```
Every admin page, the layout and the retry server action call it (verified:
`app/admin/layout.tsx:7`, `app/admin/page.tsx:9`, `app/admin/metrics/page.tsx:18`,
`app/admin/submissions/[id]/page.tsx:27`, `actions.ts:14`). The gate itself is server-side and
complete; the weakness is only in what counts as "the admin's email".

### M3: privacy page versus the code

| Privacy page says | Code does | Fix |
|---|---|---|
| "a copy stays on your device for up to 30 minutes … removed when the upload starts or when you change the file" (42-44) | Expired records are deleted only lazily, when the site next opens IndexedDB (`pendingUpload.ts:88-99`). A creator who abandons Google sign-in and never comes back keeps the video blob in the browser indefinitely. | Say "until you next open Songfit, or until you clear site data", or add a sweep on every landing load (already happens via `readPendingUpload` only when the tab has a saved flowId). |
| "We don't show your video to other creators" (52) | True. But the operator sees every video (signed URL), transcript, note and email in `/admin` (`app/admin/submissions/[id]/page.tsx:36,101`, `app/admin/page.tsx:34`). | Add: "Songfit's team can view your video and its analysis to fix problems and improve recommendations." |
| "listen to any speech in it" (36) | The transcript is stored as text (`video_analyses.transcript`) with a model summary of the video and the raw model response. | Add: "we keep a text transcript of any speech and a written description of the video." |
| Nothing on anonymous use | Visitors upload under an anonymous account before signing in; unclaimed runs are kept forever. | Add one line plus a retention period (pairs with H3's purge). |
| "do not allow them to train on your content" (37-38) | True for the API by default; both providers retain API inputs for a limited period for abuse monitoring. | Add "and delete it after a short retention period"; check the current period on each provider's policy page before quoting a number (see memory: read terms before recommending). |
| Nothing on who/where/why | Controller identity, contact (present), lawful basis, international transfers (Anthropic/OpenAI/Vercel US; Supabase region), right to complain to the ICO/your regulator, minimum age. | Add a short "Who we are and your rights" block. Minimum age: 13+ (TikTok's own), or 16+ to stay clear of EU parental-consent rules. |
| Nothing on IPs | Supabase Auth stores IP and user agent per session and in its audit log; Vercel request logs hold IPs. Songfit's own tables store no IP. | One line: "our hosting providers log IP addresses for security." |
| "Song details and 30-second samples come from Deezer" (38) | The browser loads samples and artwork straight from Deezer's CDN, so Deezer sees the viewer's IP. | "…played straight from Deezer." |

Everything else checks out: Google email + name are stored (`creators.email`, `display_name`), notes
and vibe tags are stored, events are what the page describes, nothing is posted to TikTok/Instagram,
no sale or sharing, Stripe sees card data (not built yet).

### M4: unbounded self-heal

```ts
// app/api/submissions/[id]/route.ts:39-42
if (isStaleInFlight(submission.status, submission.updated_at)) {
  logger.warn("pipeline.stale_restart", { submissionId: id, status: submission.status });
  waitUntil(runSubmission(id).catch(...));
}
```
The only cap (`retry/route.ts:31`) counts `pipeline_failed` events, which a killed function never
writes. `pipeline.stale_restart` is a log line, not a row, so nothing can count it.

### M5: guard hook

Read, not exercised. `python3 -I .claude/hooks/guard-secrets.test.py` → **25 PASS, failures: 0**.
- Matcher: `"Bash|Edit|Write|MultiEdit|Read|NotebookEdit|Grep|Glob"`. Tools outside it that take a local
  path or run code are not checked.
- Grep/Glob check only `path`, `pattern`, `glob`, `include`; a content search rooted at the repo with
  a key name as pattern is allowed. Bash `grep -r` without naming the file is allowed. CLAUDE.md calls
  this a rules violation, but it is also the most natural accidental move during an audit.
- `VERCEL_BAD = r"\b(vercel|vc)(@\S+)?(\s+-{1,2}[\w-]+(=\S+)?)*\s+(link|pull|env\s+pull)\b"`: a flag
  with a space-separated value (`--cwd .`, `--scope team`, `-t TOKEN`) breaks the chain before `link`.
- `package.json`: `"smoke": "node --env-file=<local env file> …"`, `"local": …`, `"db:push"`,
  `"db:types"`, `"test:db"` all load the secrets; `pnpm local <any script>` runs arbitrary code with
  them. `scripts/probe-apple-env.ts` is careful (prints lengths and booleans only).
- `except Exception: sys.exit(0)` on unparsable input, and any hook crash/timeout is non-blocking.

### Secrets in the bundle (item 1)

`process.env` references (excluding generated types):

| Variable | Where | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `src/db/browser.ts:12`, `components/upload.ts:42`, `middleware.ts:8`, `src/db/client.ts:15` | Client, by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `src/db/browser.ts:13`, `middleware.ts:9`, `src/db/client.ts:16` | Client, by design (RLS is the boundary, hence H1/M1) |
| `NEXT_PUBLIC_SITE_URL` | `src/shared/config.ts:83` | Client-safe |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/db/client.ts:41` via `env()` | Server only; file starts with `import "server-only"` |
| `ANTHROPIC_API_KEY` | `src/shared/anthropic.ts:59` via `env()` | Server only (pipeline) |
| `OPENAI_API_KEY` | `src/analysis/transcribe.ts:15` via `env()` | Server only |
| `INTERNAL_TOKEN` | `app/api/health/route.ts:21`, `app/api/submissions/[id]/run/route.ts:12` | Server only |
| `ADMIN_EMAILS` | `src/auth/session.ts:41,48`, `src/shared/config.ts:76` | Server only |

`src/shared/config.ts` is imported by client components (`UploadForm.tsx:19` for `LIMITS`) and has no
`server-only` guard, but its `env(name)` uses a dynamic `process.env[name]`, which Next never inlines,
so no secret can reach the bundle through it. No client module imports `src/db/client.ts`, the
Anthropic/OpenAI clients or the pipeline. Error messages carry only variable **names**
("Missing required environment variable: X"). The logger serialises only what callers pass; no call
site passes a key, token, email, transcript or note (checked every `logger.*` with those words).
Whisper errors are reduced to name/status/200 chars (`transcribe.ts:20-26`).

Git history (237 commits, all branches): no `.p8`/`AuthKey`/`.pem`/`.key` path ever; the only files
added with "env/key" in the name are `.env.example`, the hook, its test, `next-env.d.ts` and
`scripts/probe-apple-env.ts`. `-S "sk-"` hits are the template (`sk-ant-...`), a test fake
(`sk-FAKE123`) and a doc path. A regex sweep for live-key shapes (`sk-ant-…`, `sk-proj-…`, `sk_live_…`,
`whsec_…`, JWTs, PEM bodies, AWS ids) found nothing. GitHub repo is PRIVATE.

### Client storage (item 2)

| Store | Key / content | Lifetime | Cleanup |
|---|---|---|---|
| IndexedDB `songfit/pending` | `{flowId, blob (the whole video File), name, type, size, durationSeconds, savedAt}`; Google-fallback path only (`Landing.tsx:124`); vibe is not stored | 30 min logical | Deleted on upload start (`ResumeUpload.tsx:54`), file change/remove (`Landing.tsx:102,158`), sign-out (`auth.ts:21`); expired records swept only on the next stash/read (see M3). All IDB calls have a 5 s timeout and fall back to sign-in-first; quota errors reject → "storageFailed" view (`Landing.tsx:125-129`) |
| sessionStorage | `songfit.flowId` (random UUID), `songfit.signInCompleted:<flowId>` = "1" | Tab | Removed on upload start / sign-out |
| localStorage | `tus::…` fingerprints (L4). Nothing else. | Until success | — |
| Cookie `sf_claim` | 32-byte random token; DB stores only its sha256 | 1 h | `httpOnly`, `secure`, `sameSite=lax`, `path=/` (`src/auth/claim.ts:6-12`); cleared after the callback |
| Cookies `sb-<ref>-auth-token*` | Supabase access + refresh token | 400 days (library default) | `httpOnly: false` (required by the browser client), `sameSite=lax`; `Secure` not set explicitly (HTTPS-only site; Vercel serves HSTS on its domains, verify for thissongfits.com) |

No `postMessage`, no `document.cookie`, no iframe, no third-party script tag. IndexedDB is
same-origin by browser design.

---

## External origins (browser)

| Origin | Why | Credentials / data sent |
|---|---|---|
| `thissongfits.com` / `songfit.vercel.app` | App, API routes | Supabase cookies |
| `<ref>.supabase.co` | Auth (anonymous sign-in, OAuth start, token refresh), Storage upload (signed PUT, TUS), signed video playback URL | Bearer JWT on TUS; signed token in URL for PUT and playback; video `crossOrigin="anonymous"` sends **no** cookies |
| `accounts.google.com` | Google OAuth via Supabase redirect | Google's own |
| `cdnt-preview.dzcdn.net` (and other `*.dzcdn.net`) | 30 s previews, `crossOrigin="anonymous"` for Web Audio | IP, origin-only referrer, no cookies |
| `e-cdns-images.dzcdn.net`, `cdn-images.dzcdn.net` | Artwork (plain `<img>`) | IP, origin-only referrer |
| `www.deezer.com`, `www.tiktok.com`, `www.instagram.com`, `open.spotify.com` | Outbound links only | All `target="_blank" rel="noopener noreferrer"` (`Attribution.tsx:9-10`, `UseItPanel.tsx:52-53`) |

Not contacted: Google Fonts (`next/font/google` self-hosts at build), analytics or trackers (none),
Anthropic/OpenAI/Deezer API (server-side only). No `getUserMedia`/camera/mic request: the Web Audio
mix uses the uploaded video's own track and the preview element only.

---

## Personal-data inventory

| Data | Where stored | Who can see it | Retention | Deletion path |
|---|---|---|---|---|
| Google email, full name (+ Google avatar/sub in `raw_user_meta_data`) | `auth.users`; `creators.email`, `display_name` | Owner (RLS), admin, service role | Forever | Delete auth user (cascade) |
| Session IP + user agent | Supabase `auth.sessions`, auth audit log | Supabase dashboard | Supabase default | Deleted with user (sessions); audit log per Supabase |
| Uploaded video (original) | Storage `videos/<creator or anon id>/<submission>.<ext>` | Owner (own folder), admin via signed URL (1 h) | Forever | **Manual only** (H3) |
| Playback copy (H.264, no audio) | Storage `…/<submission>.playback.mp4` | Same | Forever | **Manual only** |
| Frames (~1/s, ≤60), audio track | `/tmp/songfit-*` on the function; sent to Anthropic (frames) and OpenAI (audio) | Function only; providers per their API terms | Removed in `finally` (`src/analysis/index.ts:141-142`); a killed instance's /tmp dies with it | Automatic |
| Speech transcript | `video_analyses.transcript`; sent to Anthropic | Owner (RLS select), admin | Forever | Cascade on user delete |
| Video description, story, moments, brief, raw model response | `video_analyses` | Owner (RLS), admin | Forever | Cascade |
| "Anything else?" note, vibe tags | `submissions.creator_intent`, `vibe_tags`; sent to Anthropic | Owner, admin | Forever | Cascade |
| Song candidates / picks, selections, rejections | `candidates` (service only), `recommendations` | Owner (recs), admin | Forever | Cascade |
| Event log (incl. `wanted_instead` free text ≤200 chars, `flow_id`) | `events` | Service role / admin metrics | Forever | **Survives** user delete with null ids (H3) |
| Pipeline error text | `submissions.error`, `events.metadata.raw` (≤4000 chars of model output) | Owner (column via PostgREST, L3), admin | Forever | Cascade / survives in events |
| Claim token | `creators.claim_token_hash` (sha256), `sf_claim` cookie | Service role | Nulled on claim; cookie 1 h | Automatic |
| Video blob on device | Browser IndexedDB | That browser only | 30 min logical, lazily swept | Automatic on next visit / sign-out |
| Request logs (IP, URL, UA), app logs (`submissionId`, `creatorId`, errors) | Vercel | Dylan | Per Vercel plan | Vercel |
| Song search strings (title + artist) | Deezer API (server) | Deezer | Deezer's | n/a: no personal data |

---

## What is solid

- Service-role client is `server-only` and never imported by a client module; only the three
  intended `NEXT_PUBLIC_*` values reach the bundle.
- No secret, key file or `.p8` in 237 commits; repo is private; `.vercel` and `.env*.local` ignored.
- Logs carry ids, not emails, notes or transcripts; Whisper errors are sanitised; creator-facing
  status never returns the raw error (`/api/submissions/[id]:57`).
- Admin: every page, the layout and the server action call `requireAdmin()` server-side; metrics
  show counts only, no emails; robots disallows `/admin` and `/api`.
- Ownership checks on every creator route (results page, status, preview, events), `notFound` for
  others' ids (no existence oracle), UUID validation everywhere.
- Upload path is pinned: the server builds the path, and submit requires an exact match
  (`isExactStoragePath`), then checks the stored object's real size.
- Landing events accept only `{name, flow_id}`, ≤200 bytes, per-IP limited; no filename, size or
  duration leaves the device before upload.
- `sf_claim` is httpOnly/secure/lax, one hour, hashed at rest, single-use in SQL.
- `safeNext` blocks open redirects in the OAuth callback.
- Outbound links all `noopener noreferrer`; media `crossOrigin="anonymous"` sends no credentials;
  no mic/camera, no analytics, fonts self-hosted.
- SQL functions are `security definer` with `revoke … from public, anon, authenticated`.
- Guard hook test suite green (25/25).

---

## Dashboard checklist for Dylan (cannot be verified from code)

Supabase
- [ ] Auth → Providers: **Email provider OFF** (or at least "Confirm email" ON). Phone OFF. Google ON. Anonymous ON. (M2)
- [ ] Auth → Providers/Settings: "Secure email change" ON. (M2)
- [ ] Auth → Rate Limits: anonymous sign-ins per hour per IP set low (e.g. 10). (H2)
- [ ] Auth → Attack Protection: note where CAPTCHA (Turnstile) is, ready to switch on if abuse shows up (needs a small code change to pass the token). (H2)
- [ ] Auth → URL Configuration: Site URL = `https://thissongfits.com`; Redirect URLs only prod, `songfit.vercel.app`, localhost.
- [ ] Auth → Sessions: JWT expiry 3600 s (default) and refresh-token rotation ON.
- [ ] Storage → `videos`: Public OFF; file size limit 150 MB; **allowed MIME types** `video/*`. (M1)
- [ ] Advisors → Security Advisor: no "RLS disabled" or "policy allows update" warnings after H1's migration.
- [ ] API settings: exposed schemas = `public` only; disable GraphQL if unused.
- [ ] Project region noted for the privacy page.

Anthropic console
- [ ] Monthly **spend limit** set (e.g. $150 for the challenge) and an alert email at 50 %. (H2)

OpenAI platform
- [ ] Project **budget** + alert; key restricted to the audio endpoint. (H2)

Vercel
- [ ] Env vars: secrets marked Sensitive, scoped to Production; Preview deployments do not get prod keys (or have Deployment Protection ON).
- [ ] Firewall: know where "Attack Challenge Mode" is (emergency stop for bot floods).
- [ ] Spend management / usage alerts if on Pro.
- [ ] Custom domain serves HSTS (check response headers of thissongfits.com).

Google Cloud (OAuth consent)
- [ ] Scopes only `openid email profile`; privacy policy URL = `/privacy`; authorized domains correct.

GitHub
- [ ] Secret scanning + push protection ON; 2FA ON.

---

## Prioritised fix list

1. **Today, no code:** set Anthropic + OpenAI spend limits; lower Supabase anonymous sign-in rate limit; confirm Email provider OFF / confirm-email ON; set bucket MIME types. Write the "emergency stop" (disable anonymous sign-ins, revoke Anthropic key) into RUNBOOK. (H2, M2, M1)
2. **Migration 0010:** drop `creators: update own`; tighten or drop the storage insert policy. Update DATA_MODEL.md first. (H1, M1)
3. **Deletion runbook** in RUNBOOK.md (files under both the Google and anonymous folders, then the auth user, then event text) and a monthly purge of unclaimed anonymous runs older than 30 days. (H3)
4. **Privacy page rewrite** per the M3 table. (M3)
5. **Global daily run cap** read from an env var, checked in `/api/upload-url`. (H2)
6. **Cap self-heal restarts** at 2 per submission. (M4)
7. `requireAdmin` also requires the Google provider and a confirmed email. (M2)
8. **Guard:** move the secrets file out of the repo; widen the matcher; fix the Vercel regex. (M5)
9. Security headers in `next.config.ts`; `.gitignore` additions; drop Apple env leftovers. (L1, L5)
10. Optional: revoke `submissions.error` column select, clear `tus::` keys on sign-out, constant-time token compare. (L3, L4, I1)
