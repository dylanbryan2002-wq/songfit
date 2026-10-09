# 22 · Security audit: HTTP routes, input handling, abuse and cost

Auditor: Claude (read-only review; nothing was edited except this file). Date: 2026-10-08.
Scope: every route under `app/api/**`, `app/auth/callback`, the server-rendered pages with side effects,
the one server action, the Storage/RLS rules those routes depend on, ffmpeg on untrusted input,
headers, cookies, dependencies. Severity reflects how easy the attack is and what it costs Dylan.

Assumed cost per pipeline run: about **$0.40** (docs/review/18 and docs/RUNBOOK.md:18: ~$0.34 recommend stage
plus analysis, Whisper, Vercel CPU). No global spend ceiling exists in code.

---

## 1. Route inventory

| Route | Auth (helper) | Ownership check | Validation | Limits | Cost when called |
|---|---|---|---|---|---|
| `POST /api/upload-url` | `getViewer()` (Google or anonymous) | n/a (path built from session uid) | Zod `{ext enum, sizeBytes ≤ 150 MB}` (route.ts:12-15) | daily cap 10 / anon 3 counted on `submissions` rows, 5/min burst (DB count + per-instance map) (rateLimit.ts:46-51) | 1 signed upload URL; up to 150 MB Storage per URL |
| `POST /api/submissions` | `getViewer()` | idempotent re-POST checks `creator_id` (route.ts:36-40); exact path match (route.ts:43) | Zod: uuid, path ≤ 200, ext enum, note ≤ 140 trimmed, ≤ 3 known tags (route.ts:19-25, vibe.ts:20-33) | daily cap check (route.ts:46) — **not atomic** (F1) | **Full pipeline** via `waitUntil`: ffprobe/ffmpeg ×4, Whisper, Claude analysis (≤ 60 images), candidates, scoring, explain, ~30-70 Deezer calls, playback upload. ~$0.40 + up to 300 s function |
| `GET /api/submissions/[id]` (status poll, every 3 s) | `getViewer()` | owner or admin (route.ts:34) | `isUuid` | none | 1-2 DB reads; **restarts the pipeline** when the run is stale > 6 min (route.ts:39-42), uncapped (F8) |
| `POST /api/submissions/[id]/retry` | `getCreator()` (Google only) | owner (route.ts:25) | `isUuid` | only `failed` or stale; ≤ 3 `pipeline_failed` events (route.ts:27-33) | Pipeline from the failed stage |
| `POST /api/submissions/[id]/run` | `x-internal-token` header == `INTERNAL_TOKEN` (route.ts:11-14) | none (internal) | none (no uuid check) | none | Pipeline, synchronous |
| `POST /api/submissions/[id]/feedback` | `getCreator()` | owner, status ready | Zod discriminated union, rank 1..15 | none | 1 RPC + 1 event row |
| `POST /api/submissions/[id]/events` | `getCreator()` | owner, status ready | Zod union; `wanted_instead` text trimmed 1..200 | **none** | 1 event row per call (F9) |
| `GET /api/submissions/[id]/preview/[rank]` | `getCreator()` | owner or admin, ready | uuid + `/^[1-9]\d?$/` ≤ 15 | **none** | 1 Deezer `/track/{id}` call (F5) |
| `POST /api/claim` | `getViewer()`, anonymous only | own row | no body | none | 1 DB update, sets `sf_claim` (httpOnly, Secure, Lax, 1 h) |
| `POST /api/landing-events` | none (session needed for 2 of 5 names) | n/a | ≤ 200 bytes, Zod `.strict()` `{name enum, flow_id uuid}` | 30/min per IP, **per instance only** | 1 event row |
| `GET /api/health` | none; `?sleep` needs `x-internal-token` | n/a | `sleep` clamped ≤ 290 | none | `?binaries=1` reveals binary paths (F12) |
| `GET /auth/callback` | OAuth code exchange | `claim_anonymous` needs the hashed one-time cookie token | `safeNext()` same-origin only | Supabase | DB writes, events |
| `GET /results/[id]` (page) | `getViewer()` | `gateDecision` owner/admin | `isUuid` | none | **15 Deezer lookups per page load** (picker.ts:48-58), signed URL, events (F5) |
| `GET /results/latest`, `/results` | `getCreator()` | own newest | n/a | none | 1 DB read |
| `/admin/**` pages + `retrySubmission` action | `requireAdmin()` in layout, every page and the action | admin | `isUuid` in the action | none | Pipeline (admin only) |
| Stripe webhook | **does not exist yet** | — | — | — | — |

Outside the routes but reachable by every signed-in or anonymous browser with the public anon key:
- Supabase Storage `videos` bucket: **insert into own folder** (0003_rls.sql:55-57) — direct uploads that skip `/api/upload-url` (F3).
- Supabase PostgREST `creators`: **update own row, any column** (0003_rls.sql:9-10) (F4).

---

## 2. Findings

| ID | Severity | Title | Where | Exploit scenario | Fix |
|---|---|---|---|---|---|
| F1 | **High** | Daily run cap is check-then-insert, so parallel POSTs bypass it | app/api/submissions/route.ts:46 then :55; 0006_paywall_off.sql (no daily count) | Upload N objects straight to Storage (F3), fire N concurrent `POST /api/submissions`; all read count < cap before any insert. N full runs per account (anonymous included) | Move the 24 h count into `create_submission()` under the existing advisory lock (raise `daily_limit`), as the paywall already is |
| F2 | **High** | No global spend ceiling; anonymous cap resets with every new anonymous session | src/billing/rateLimit.ts:36-38; components/landing/anonSession.ts:15 | Script: `signInAnonymously` → 3 runs → new session. Only backstop is Supabase's anonymous sign-in limit (default 30/h per IP; prod value unverified). ≈ 90 runs/h/IP ≈ $36/h per IP, unbounded with rotating IPs; × N with F1 | Global daily run ceiling in `create_submission()` (e.g. 300/day, raise `busy`); Turnstile captcha on anonymous sign-in (Supabase `[auth.captcha]`); hard monthly spend limit in the Anthropic and OpenAI consoles; Vercel Firewall rate rule on `/api/submissions` and `/api/upload-url` |
| F3 | **Medium** | Storage RLS lets any session upload unlimited 150 MB objects, skipping `/api/upload-url` | supabase/migrations/0003_rls.sql:55-57; bucket has no `allowed_mime_types` (0001_init.sql:300-302); no orphan cleanup anywhere | Anonymous session PUTs thousands of 150 MB files to `<uid>/<anything>`; Storage bill grows; also feeds F1 without the 5/min issuance limit | Drop the authenticated insert policy (signed upload URLs from the service role do not need it); set `allowed_mime_types` to video types; delete objects with no submission after 24 h (manual script now) |
| F4 | **Medium** | `creators: update own` allows rewriting `email`, letting anyone squat a victim's address and block their Google sign-up | 0003_rls.sql:9-10; email unique (0001_init.sql:7); trigger only handles `on conflict (id)` (0009_anonymous.sql:15-22) | Anonymous user PATCHes `creators?id=eq.<self>` `{email:"victim@gmail.com"}`. Victim's first Google sign-in: trigger insert hits the unique email → auth user insert fails → victim can never sign up | Drop the update policy (nothing in app/ writes creators with the user client) or restrict to `display_name`/`preferences` via column grants |
| F5 | **Medium** | Deezer quota is shared per server IP and user-triggerable without limit | src/feedback/picker.ts:45-58 (15 lookups per results page load); preview route has no limit; pacing is per instance (deezer.ts:37-46) | Reloading a results page in a loop, or hammering `/preview/[rank]`, burns Deezer's ~50 req/5 s per IP; concurrent pipelines on that instance get "Quota limit exceeded", fail verification, and burn retries | Cache the per-submission preview lookups for ~10 min (in-memory is fine), cap preview refreshes per creator, skip lookups when `PREVIEWS_ENABLED` is false |
| F6 | **Medium** | ffmpeg/ffprobe on untrusted files: ffprobe is **4.0.2 (2018)**, ffmpeg 6.1.1 (2023), no protocol/format whitelist, children inherit all secrets | src/media/extract.ts:26-31, 44-50, 89-101, 110-120; src/media/transcode.ts:49-53; ffprobe-static 3.1.0 linux binary = `4.0.2-static` | Upload an HLS playlist named `.mp4`: the demuxer probes content, not extension, and fetches `http://` segments (blind SSRF from Vercel; result may come back in the playback copy). A memory-corruption bug in the 2018 ffprobe would run inside a process whose env holds `SUPABASE_SERVICE_ROLE_KEY` | Add `-protocol_whitelist file` to every ffprobe/ffmpeg call; reject unless ffprobe `format_name` is in {mov,mp4,m4a,3gp,3g2,mj2, matroska,webm}; probe with the newer ffmpeg build (or a current ffprobe binary); pass `env: { PATH: "" }` to `execFile`; add `-t 180` to frames/audio/transcode |
| F7 | Low | No security headers (CSP, X-Frame-Options/frame-ancestors, nosniff, Referrer-Policy, Permissions-Policy) | next.config.ts (no `headers()`); middleware.ts sets none | Clickjacking of the picker; no defence-in-depth if an XSS ever lands | `headers()` in next.config.ts: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`; CSP later |
| F8 | Low | Stale-run self-heal is not counted against the retry cap | app/api/submissions/[id]/route.ts:39-42; retry cap counts only `pipeline_failed` (retry/route.ts:31) | A run that dies hard (killed past 300 s, deploy) writes no `pipeline_failed`, so every poll after 6 min restarts it, forever while the tab is open | Log `pipeline_failed` (stage `stale`) on reclaim, or count reclaims and stop after 3 |
| F9 | Low | Event-writing routes are unthrottled | events/route.ts (no limit); landing-events limiter is per instance (landing-events/route.ts:21-31) | Loop writes millions of `events` rows; metrics polluted, DB grows | Per-creator cap per submission (e.g. 200 events) and a DB-side count check for landing events |
| F10 | Low | Deezer URLs stored and rendered as `href` without scheme check | deezer.ts:12-18 (`z.string()`), Attribution.tsx:8 | Only exploitable if Deezer returns `javascript:` (compromise); React 19 warns but still renders | `z.string().url().startsWith("https://")` for `link`, `preview`, covers |
| F11 | Low | `INTERNAL_TOKEN` compared with `!==`; `/run` does no uuid check | run/route.ts:12, 16; health/route.ts:21 | Timing attack impractical over the network; malformed id → 500 | `crypto.timingSafeEqual`; `isUuid(id)` |
| F12 | Info | `/api/health?binaries=1` is public | health/route.ts:34-40 | Reveals `/var/task/...` paths only | Gate behind the internal token |
| F13 | Info | `pnpm audit --prod`: 4 advisories (2 high, 2 moderate), all `postcss` bundled inside `next` | `.>next>postcss` | Build-time CSS tooling; not reachable from requests | Bump `next` when a patch release pulls postcss ≥ 8.5.23 |
| F14 | Info | Supabase auth cookies: `httpOnly: false`, no explicit `Secure` (library default) | middleware.ts:14-20 | By design (browser client reads them); Vercel serves HTTPS only | Accept; keep XSS sinks at zero |

Counts: Critical 0 · High 2 · Medium 4 · Low 5 · Info 3.

---

## 3. Details

### F1 · Daily cap race (High)
```ts
// app/api/submissions/route.ts:46-60
if (await overDailyLimit(creator.id, dailyUploadLimit(creator.anonymous))) { ... 429 }
const info = await objectInfo(path);
...
submission = await createSubmission({ id: submissionId, creatorId: creator.id, ... });
```
`overDailyLimit` is a plain `count(*)` (src/db/queries/submissions.ts:175-183). `create_submission()` takes
`pg_advisory_xact_lock` but only checks the paywall (`used_count >= 1000`, 0006_paywall_off.sql). Two requests
in flight both see `count = 2 < 3`. `/api/upload-url` has its own per-minute limit, but it is not needed: the
create route only requires that an object exist at `<uid>/<submissionId>.<ext>` (route.ts:43, 49-50), and F3
lets the user put it there directly. Each extra request = one full paid run.

### F2 · No ceiling on anonymous runs (High)
`dailyUploadLimit(true) = 3` is keyed on the anonymous user id. A new anonymous id costs one
`signInAnonymously()` call with the public anon key. Backstops that exist today:
- Supabase `anonymous_users` rate limit: 30 sign-ins/hour per IP (local `supabase/config.toml:204`; confirm the
  hosted project uses the same value in the dashboard).
- Nothing else: no captcha (`[auth.captcha]` commented out, config.toml:215), no Vercel Firewall rules, no
  `vercel.json`, no global count, no per-IP limit on any spend route. Retries are Google-only, so they do not add.
Worst case from one IP without F1: ~90 runs/hour ≈ $36/hour, ~$860/day. With F1 each session can do more.
The only real stop today is whatever monthly limit is set in the Anthropic and OpenAI consoles.

### F3 · Direct Storage upload (Medium)
```sql
-- 0003_rls.sql:55-57
create policy "videos: upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
```
`authenticated` includes anonymous sessions. Signed upload URLs from the service role do not need this policy.
The bucket has a 150 MB size limit but no MIME allow-list, and nothing deletes uploads that never became a
submission (no `.remove(` outside a probe script). `objectInfo()` returns `mimeType` but the route ignores it.

### F4 · Email squatting through `creators: update own` (Medium)
```sql
-- 0003_rls.sql:9-10
create policy "creators: update own" on public.creators
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
```
No column restriction. `email` is `unique` (0001_init.sql:7). `handle_new_user()` inserts the email and only
tolerates `on conflict (id)` (0009_anonymous.sql:15-22), so a duplicate email raises inside the `auth.users`
insert trigger and the victim's Google sign-up fails. Admin rights are NOT affected: `isAdmin` reads the auth
JWT email (src/auth/session.ts:39-49), and `ensureCreator` rewrites email on every Google request.

### F5 · Deezer amplification (Medium)
`loadPicker` does `Promise.all(rows.map(previewFor))`: 15 `/track/{id}` calls on every results-page render
(picker.ts:48-58). The preview refresh route has no limit. Pacing (`deezerMinIntervalMs` 120 ms, concurrency 6)
is module state per instance, and Deezer's ~50 req/5 s limit is per egress IP. A reload loop starves pipeline
verification running on the same instance; failed verifications burn retries. No SSRF here: the host is fixed
(`https://api.deezer.com/track/${encodeURIComponent(id)}`, deezer.ts:137) and `deezer_id` comes from Deezer.

### F6 · ffmpeg on untrusted input (Medium)
Good: `execFile` (no shell), local tmp paths, `SIGKILL` timeouts (20/90/60 s, transcode ≤ 60 s), frames capped
at 60, duration checked ≤ 180 s, deadline-bounded. Missing:
- Version: production ffprobe is `4.0.2-static` (johnvansickle, 2018) from `ffprobe-static@3.1.0`; ffmpeg is
  release `b6.1.1` from `ffmpeg-static@5.3.0`. Both have published demuxer CVEs since.
- Format: no `-f`/format check. ffprobe and ffmpeg pick the demuxer from content, so a `.mp4` containing an HLS
  playlist is opened as HLS and its `http://` segments are fetched (blind SSRF from Vercel; newer ffmpeg releases
  refuse HLS with a non-`.m3u8` name, these versions likely do not — verify). Local-file tricks are mostly closed
  by HLS `allowed_extensions` and protocol checks in these versions.
- Environment: `execFile` without `env` hands every secret to the child.
- Memory: no limit beyond the function's; ffmpeg OOM is killed and becomes a `failed` run (fine).
- Duration lie: `format=duration` can understate stream length; audio/transcode have no `-t`.

### F8 · Uncapped self-heal (Low)
```ts
// app/api/submissions/[id]/route.ts:39-42
if (isStaleInFlight(submission.status, submission.updated_at)) {
  waitUntil(runSubmission(id)...);
}
```
Reclaims do not write `pipeline_failed`, which is what the retry cap counts. The pipeline budget (280 s of 300 s)
makes hard deaths rare, but download (`downloadToTmp`) and playback upload are not deadline-bounded.

---

## 4. Answers to the brief

1. **Cost abuse.** Paid routes: `POST /api/submissions` (full run), `/retry` (Google only, ≤ 3 failures),
   `/run` (token), status-poll self-heal (stale only), admin action. Re-POSTing create with the same id is
   idempotent (route.ts:36-40, SQL `p_id` check): no second run. `/results/latest` only redirects. Preview refresh
   and results page cost Deezer quota, not money (F5). Landing events cost DB rows only. Clearing cookies resets the
   anonymous cap by design; the only backstop is Supabase's per-IP anonymous sign-in limit (F2). There is **no
   per-IP limiting on Vercel** for any spend route (only landing-events, per instance).
2. **Input validation.** Every JSON body goes through Zod; `creator_intent` ≤ 140 trimmed, tags ≤ 3 from the
   allow-list, `wanted_instead` ≤ 200, feedback rank 1..15, landing body ≤ 200 bytes `.strict()`. Song reports
   (`song_not_found`) carry only a rank. File checks server-side: ext enum, bucket 150 MB, size re-read from Storage
   (route.ts:49-51), duration ≤ 180 s at ffprobe. No MIME/container check (F3, F6). Paths cannot be injected: the
   server builds `uid/uuid.ext` and requires exact equality (storage.ts:8-15); the client never sends a filename.
3. **SSRF / outbound.** No route fetches a user URL. Deezer host is fixed, id is encoded. Deezer responses are
   Zod-parsed but URLs are `z.string()` (F10). ffmpeg is the one SSRF path (F6).
4. **XSS.** No `dangerouslySetInnerHTML`, `innerHTML` or `eval` in app/, src/, components/. Model text and Deezer
   titles render as React text. Deep links encode with `encodeURIComponent` (UseItPanel.tsx:23;
   `spotifySearchUrl`). Only `deezer_url` reaches `href` unvalidated (F10). Prompt injection via transcript or the
   140-char note can only change text shown to the same creator; songs must still pass Deezer.
5. **Webhooks / internal.** No Stripe webhook exists. `/run` and `/health?sleep` use the header only (never the
   query), fail closed when `INTERNAL_TOKEN` is unset, compare with `!==` (F11). Aborted client requests do not
   stop `waitUntil`; a killed function leaves a stale row that self-heals (F8).
6. **Errors / logs.** Bodies are fixed codes; the status route never returns the stored error (route.ts:57).
   Unhandled throws give Next's generic 500. Logs carry ids, stage, error strings and counts; no emails,
   transcripts or prompts (`transcribed` logs length only; Whisper errors sanitised in `safeMessage`). Model raw
   text goes to the `events` table (service-role only), not logs.
7. **Headers / transport.** None set (F7). `sf_claim` is httpOnly + Secure + Lax. Supabase cookies Lax, not
   httpOnly (F14). No CORS headers anywhere, so cross-origin reads are blocked; SameSite=Lax blocks cross-site
   POST with cookies (CSRF covered); server actions get Next's origin check.
8. **Dependencies.** See F13 (postcss in next, build-time). ffmpeg-static 5.3.0 → ffmpeg 6.1.1; ffprobe-static
   3.1.0 → ffprobe 4.0.2 on Linux (F6).

---

## 5. What is solid

- Ownership is checked on every submission route, and wrong-owner answers are `404`/`403` with no data.
- Anonymous viewers never get picker data, signed playback URLs or retries (`getCreator()` on retry, feedback,
  events, preview; `gateDecision`).
- Storage paths are server-built and compared by exact string; no filename ever reaches the server.
- One atomic claim (`claim_submission_run`) makes concurrent triggers safe; create is idempotent per id.
- Admin is gated in the layout, every page and the server action, using the Google JWT email.
- `safeNext()` blocks open redirects; the claim token is 32 random bytes, stored only as a sha256, one-time.
- Zod on all bodies and on every Deezer and model response; no HTML sinks.
- ffmpeg runs via `execFile` with hard SIGKILL timeouts inside a pipeline deadline.
- Error bodies and logs avoid raw provider errors, transcripts and emails.

---

## 6. Prioritised fix list

1. **Today, no code:** set hard monthly spend limits in the Anthropic and OpenAI consoles; confirm the hosted
   Supabase anonymous sign-in rate limit (30/h/IP or lower).
2. **F1 + F2:** move the per-creator 24 h count and a new global daily ceiling into `create_submission()` (one
   migration, under the existing lock). Needs a DATA_MODEL.md update first.
3. **F3:** drop the `videos: upload own folder` insert policy; add `allowed_mime_types` to the bucket.
4. **F4:** drop `creators: update own` (or column-restrict it).
5. **F6:** `-protocol_whitelist file` + format allow-list + `env` stripped on every ffmpeg/ffprobe call; replace
   the 2018 ffprobe.
6. **F2 (cont.):** Turnstile captcha on anonymous sign-in; Vercel Firewall rate rule on `/api/upload-url` and
   `/api/submissions`.
7. **F5:** cache preview lookups; limit the preview refresh route.
8. **F7, F8, F9, F10, F11:** headers in next.config.ts; count reclaims; cap events per submission; URL schemes;
   `timingSafeEqual`.
