# 23 — Live API stress test (thissongfits.com)

Date: 2026-10-09. Target: https://thissongfits.com (production, Next.js on Vercel + Supabase).
Owner-authorised. Method: anonymous Supabase sessions (`signInAnonymously` with the anon key,
`@supabase/ssr` cookie jar) driving the real app routes, plus the Supabase layer directly
(storage + table RLS) with the anonymous user JWT. Throttled to ~18 req/min; the firewall was
tripped once on purpose (probe 7) then backed off.

Scripts (scratchpad, not committed to app): `scripts/stress-lib.ts`, `stress-p1.ts`,
`stress-p2.ts`, `stress-p3.ts`, `stress-verify.ts`. Raw log: 77 recorded probes.

## Budget used
- Real pipeline runs that cost model spend: **1** (the 6 s mp4). 69 candidates, 15 recommendations.
- Two extra submissions were created to exercise the 3/day cap; both were tiny garbage objects
  that failed fast at ffprobe (status `failed`, 0 candidates, 0 analyses) → **~$0 model spend**.
- One deliberate Vercel firewall trip (probe 7), then stopped.

## Real runs
| run | id | result | timing |
|-----|----|--------|--------|
| #1 real (6 s mp4) | `d90a6270-84e2-4e2b-8a59-7878b9fbf619` | ready | analyzing@3s → recommending@36s → ready@134s; eta 133 → 97 → 0 |
| #2 garbage (cap test) | `37fc6784-e9a2-4b73-8028-5c2012fc22b2` | failed fast (ffprobe), $0 | n/a |
| #3 garbage (cap test) | `31add872-d1de-483d-800d-0121ec98b618` | failed fast (ffprobe), $0 | n/a |

Anonymous owner GET `/results/<real id>` before sign-in: 200, 12.3 KB HTML, **no song/picker
data** (`spotify.com`/`deezer track`/`data-rank`/`preview_url` all absent), sign-in gate present. Gate held.

## Results (probe · request · expected · actual · verdict)

### 1. Unauthenticated routes (GET + POST on every `app/api/**`)
| request | expected | actual | verdict |
|---|---|---|---|
| GET /api/health | 200 | 200 `{ok,slept:0}` | PASS |
| POST /api/health | 405 | 405 | PASS |
| GET /api/upload-url | 405 | 405 | PASS |
| POST /api/upload-url | 401 | 401 `unauthenticated` | PASS |
| GET /api/signout | 405 | 405 | PASS |
| POST /api/signout | 401 | 401 | PASS |
| GET /api/landing-events | 405 | 405 | PASS |
| POST /api/landing-events | 400 | 400 `bad_request` | PASS |
| GET /api/submissions | 405 | 405 | PASS |
| POST /api/submissions | 401 | 401 | PASS |
| GET/POST /api/claim | 405 / 401 | 405 / 401 | PASS |
| GET /api/submissions/<id> | 401 | 401 | PASS |
| POST /api/submissions/<id>/retry | 401 | 401 | PASS |
| POST /api/submissions/<id>/feedback | 401 | 401 | PASS |
| POST /api/submissions/<id>/run | 403 | 403 `forbidden` (internal-token gate) | PASS |
| POST /api/submissions/<id>/events | 401 | 401 | PASS |
| GET /api/submissions/<id>/preview/1 | 401 | 401 | PASS |

No 500s, no stack traces, no raw error text anywhere.

### 2. Input validation
`POST /api/upload-url`: missing fields, wrong types, sizeBytes 0 / -1 / 151 MB / 1e12,
ext `../../x`, `mp4; rm`, unknown ext, non-JSON → **all 400 `invalid_body`**. PASS.
300 KB body with an extra `pad` key → **200** (Zod default strips unknown keys; URL minted). See FINDING 2.

`POST /api/submissions`: missing fields / bad uuid / 300-char intent / 4 vibe tags / unknown tag /
non-JSON → 400 `invalid_body`; path traversal `../../etc/passwd` and foreign-uid path →
403 `forbidden_path`; valid shape pointing at a non-existent object → 400 `upload_not_found`
(**rejected before the pipeline**). PASS. No duplicate-id test needed to run a pipeline — idempotency
path is read-only (`getSubmission` returns the existing row).

### 3. Storage with anonymous user JWT
| request | expected | actual | verdict |
|---|---|---|---|
| upload `<other-uuid>/<uuid>.mp4` | refused | REJECTED — RLS policy | PASS |
| upload `<own>/evil.exe` | refused | REJECTED — mime not supported | PASS |
| upload `<own>/not-a-uuid.mp4` | refused | REJECTED — RLS (name regex) | PASS |
| `text/plain` named `.mp4` | refused | REJECTED — mime text/plain not supported | PASS |
| valid `<own>/<uuid>.mp4` tiny | allowed | ACCEPTED (then cleaned up) | PASS |
| 2 MB signed PUT (real run) | allowed | 200 | PASS |

RLS name regex (`^<uid>/[0-9a-f-]{36}\.(mp4\|mov\|webm\|m4v)$`) and the bucket MIME allow-list both
enforced server-side. (7 MB TUS path not separately uploaded; the real-run signed PUT covers the
<6 MB path, and 0010's policy governs both.)

### 4. RLS with anonymous JWT (supabase-js)
| request | expected | actual | verdict |
|---|---|---|---|
| select submissions / recommendations / video_analyses / candidates / events | 0 rows | 0 rows (no client policy) | PASS |
| select own creators row | 1 row | 1 row (email null) | PASS |
| select other creators rows | 0 rows | 0 rows | PASS |
| update own creators.email | refused | REJECTED — permission denied | PASS |
| insert into events | refused | REJECTED — permission denied | PASS |

0010's `revoke insert/update/delete ... from anon, authenticated` and the dropped read policies hold.

### 5. Caps (anonymous session, 3/day)
Real run #1 created, then 2 garbage submissions created (201), then the **4th mint returned
429 `daily_limit`**. The cap is enforced at `/api/upload-url` (`checkUploadRate` → DB count) and
again atomically inside `create_submission()` (0010) — defence in depth. PASS.

### 6. Concurrency
- 5 parallel `POST /api/upload-url` (one session) → `200,200,200,200,200`. PASS.
- 3 parallel `POST /api/submissions` with different invalid payloads → `400,400,403`, **no 500**. PASS.

### 7. Firewall
25 rapid GET `/api/submissions/<rand-uuid>` → twelve `404` then `429` at request #13
(Vercel firewall; the status route has no app-level limiter). Fired once, then stopped. PASS.

### 8. Status / retry / health / claim edge cases
- GET `/api/submissions/<rand-uuid>` unauth → 401; `/not-a-uuid` → 401 (auth checked before id shape).
  As the authed owner a random uuid → 404 `not_found`. PASS.
- `/api/health?sleep=1` without the internal token → 200 `slept:0` (sleep ignored). PASS.
- `/api/health?binaries=1` → 200, ffmpeg + ffprobe present and executable on the serverless fn. PASS.
- retry / run / claim unauthenticated → 401 / 403 / 401. PASS.

### 9. Headers
| path | HSTS | nosniff | X-Frame-Options | Referrer-Policy | x-powered-by | cache-control |
|---|---|---|---|---|---|---|
| `/` | ✅ 2y incl. subdomains | ✅ nosniff | ✅ DENY | ✅ strict-origin-when-cross-origin | ⚠️ `Next.js` | private, no-store |
| `/privacy` | ✅ | ✅ | ✅ | ✅ | — none — | public, max-age=0, must-revalidate |
| `/results/<rand>` | ✅ | ✅ | ✅ | ✅ | ⚠️ `Next.js` | private, no-store |

All five security headers present everywhere. `/results/<rand>` unauth → 307 (redirect to `/`).
Permissions-Policy `camera=(), microphone=(), geolocation=()` also present (next.config).

### 10. Second real run — see "Real runs" above. Pipeline healthy end to end; gate held.

## FINDINGS
- **FINDING 1 — LOW — `x-powered-by: Next.js` leaks on `/` and `/results/*`.** Minor framework
  fingerprinting (absent on `/privacy`, which is statically cached). Fix: add
  `poweredByHeader: false` to `next.config.ts`.
- **FINDING 2 — LOW — no request-body size cap on `/api/upload-url` and `/api/submissions`.**
  A 300 KB JSON body is accepted and parsed (`request.json()`), only then validated by Zod (unknown
  keys stripped, so no data corruption). Unbounded body is a small memory/DoS surface. Fix: read
  `request.text()` and reject over a few KB before `JSON.parse`, as `/api/landing-events` already
  does (200-byte cap).

No HIGH or MEDIUM findings. No 500s, no stack traces, no raw pipeline errors exposed to clients.

## What held
- Auth: every mutating route rejects unauthenticated callers (401), admin/internal routes 403.
- Input validation: Zod + exact storage-path equality reject every malformed/hostile payload
  before any pipeline work; path traversal and foreign-uid paths → 403.
- Storage: RLS name regex + bucket MIME allow-list refuse foreign folders, wrong extensions and
  spoofed content types; only the exact `<uid>/<uuid>.<ext>` video shape is accepted.
- RLS: anon/authenticated have no table read policies (0 rows) and no write grant (permission
  denied) on `public.*`; own `creators` row readable, others not.
- Caps: anonymous 3/day enforced at mint and atomically in `create_submission()`.
- Privacy gate: anonymous owner cannot see song titles / picker / signed playback before Google
  sign-in; results page shows only the sign-in gate.
- Firewall: per-IP 429 trips under heavy burst to `/api/submissions*`.
- Resilience: concurrent invalid submissions and parallel mints never 500; stale/garbage runs fail
  fast at ffprobe with zero model spend; failed status returns a generic flag, never the raw message.
