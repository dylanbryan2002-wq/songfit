# 17 — Anonymous upload plan (not built)

2026-10-08. Ships tomorrow, not tonight: it touches the auth trigger and every creator route.

## What the docs say (primary sources)

Anonymous sign-ins — https://supabase.com/docs/guides/auth/auth-anonymous
- "Calling `signInAnonymously()` creates an anonymous user. It behaves like a permanent user, except the user can't access their account if they sign out, clear browsing data, or use another device."
- "Like permanent users, the `authenticated` Postgres role will be used when using the Data APIs to access your project. JWTs for these users will have an `is_anonymous` claim which you can use to distinguish in RLS policies."
- "Converting an anonymous user to a permanent user requires linking an identity to the user. This requires you to enable manual linking in your Supabase project." (link: /dashboard/project/_/auth/providers)
- "You can use the `linkIdentity()` method to link an OAuth identity to the anonymous user."
- Existing account: "In some cases, you may need to link an anonymous user to an existing account rather than creating a new permanent account. This process requires manual handling of potential conflicts." Its sample then signs in to that account and says "Reassign entities tied to the anonymous user".
- Abuse: "It is strongly recommended to enable invisible CAPTCHA or Cloudflare Turnstile to prevent abuse for anonymous sign-ins. An IP-based rate limit is enforced at 30 requests per hour which can be modified in your dashboard." (/dashboard/project/_/auth/rate-limits)
- "Automatic cleanup of anonymous users is currently not available." (SQL given: delete from auth.users where is_anonymous is true and created_at < now() - interval '30 days')

Identity linking — https://supabase.com/docs/guides/auth/auth-identity-linking
- "Supabase Auth allows a user to initiate identity linking with a different email address when they are signed in. To link an OAuth identity to the user, call `linkIdentity()`" — `supabase.auth.linkIdentity({ provider: 'google' })`.
- "You can enable manual linking from your project's authentication configuration options (/dashboard/project/_/auth/providers) or by setting the environment variable GOTRUE_SECURITY_MANUAL_LINKING_ENABLED: true when self-hosting."
- The page does not say what happens when the Google identity already belongs to another user.

Error codes — https://supabase.com/docs/guides/auth/debugging/error-codes
- `identity_already_exists`: "The identity to which the API relates is already linked to a user."

Auth server source (github.com/supabase/auth, internal/api/identity.go, external.go — read, not docs):
`linkIdentityToUser` returns 422 `identity_already_exists` "Identity is already linked to another user";
`redirectErrors` redirects back with `error_code` in query and fragment. No session for the
existing account is issued; the anonymous session stays.

**Hard case, resolved:** a returning creator on a new device who calls `linkIdentity` gets
`identity_already_exists` and lands on `/auth/callback` with no `code`. The docs' own answer is
"sign in to the existing account, then reassign entities". So the fallback is required anyway.

Versions: `@supabase/ssr` 0.5.2, `supabase-js` 2.117.2; installed typings declare both
`signInAnonymously()` and `linkIdentity()`.

## Decision: one path, no linkIdentity (simpler option)

Because the transfer fallback must exist for returning creators, use it for EVERYONE:
gate tap → server writes a one-time claim token for the anonymous creator and sets it as an
httpOnly cookie → normal `signInWithOAuth` (the existing `signInWithGoogle`) → callback exchanges
the code, then moves the anonymous creator's submissions to the Google creator with the service
role, keyed by the cookie token. Same code for new and returning creators. Manual linking is not
needed. Cost: an empty anonymous `auth.users` row remains.
Option B (linkIdentity, transfer on conflict): +2 h, two paths; skip.

## Critical finding: anonymous sign-in fails today

`handle_new_user()` (0001) inserts `new.email` into `creators.email text not null`. Anonymous users
have no email, so the trigger raises and `signInAnonymously()` fails. Migration required.

## Flows

```
New visitor:      / → Choose video → signInAnonymously() (if no session) → upload-url → upload
                  → POST /api/submissions (run starts, waitUntil) → /results/<id> WaitingState
                  → ready → Gate "Your songs are ready" + Google → POST /api/claim (cookie)
                  → Google → /auth/callback: exchange, ensureCreator, claim → /results/<id> picker
Returning, signed in (Google session): / → UploadForm (unchanged). /results gate never shown.
Returning, new device: same as new visitor; Google returns the EXISTING user; callback claim moves
                  the submission to that creator. Nothing re-runs.
Never signs in:   run completes; submission + video stay under the anon uid. Not counted as a creator.
                  Storage: typical 20–50 MB; 1,000 abandoned ≈ 40 GB, inside Pro's 100 GB. Policy: leave
                  them; later delete anon users >30 days (cascades to submissions) AND their
                  `videos/<uid>/` objects via the Storage API (cascade does not touch objects).
In-app browser:   keep InAppNotice before upload (Google blocks OAuth in webviews; run orphaned).
```

## Code changes, file by file

1. `docs/DATA_MODEL.md` first: `creators.email` nullable (null = anonymous); `creators.claim_token_hash text`
   nullable unique; events; LIMITS; `claim_anonymous()`; metrics rule.
2. `supabase/migrations/0009_anonymous.sql`:
   `alter table creators alter column email drop not null; add column claim_token_hash text unique;`
   `claim_anonymous(p_token_hash text, p_creator_id uuid) returns int` (security definer, service role
   only): lock the anon creator row where `claim_token_hash = p_token_hash and email is null and id <> p_creator_id`;
   `update submissions set creator_id`, `update events set creator_id`; null the hash; return rows moved.
   Redefine `metrics_summary()` (rule below). Then `pnpm db:types`.
3. `src/auth/session.ts`: add `getViewer(): {id, anonymous} | null` (`user.is_anonymous`). `getCreator()`
   unchanged — it already returns null without an email, so every route using it rejects anon sessions.
4. `src/shared/config.ts`: `dailyUploadsAnonymous: 3`. `src/billing/rateLimit.ts`: `checkUploadRate(id, limit)`.
5. `app/api/upload-url/route.ts`, `app/api/submissions/route.ts`, `app/api/submissions/[id]/route.ts`
   (status), `.../retry/route.ts`: `getCreator` → `getViewer`; cap = anonymous ? 3 : 10.
   `returned_with_second_submission` only when not anonymous.
6. `components/landing/Landing.tsx`: on a valid pick → `getSession()`; if none, `signInAnonymously()`;
   fire `anon_session_started`; render `<UploadForm initialFile autoStart />`. Stash/ResumeUpload left as is.
7. `components/UploadForm.tsx`: `creator.email` optional (hide "Signed in as"); `autoStart` prop submits
   once on mount (vibe chips skipped for anon). Daily-limit copy for anon: "Sign in to upload more."
8. `app/results/[id]/page.tsx`: `getViewer`; owner check unchanged. Pure `gateDecision()` in
   `src/auth/gate.ts` → `waiting | gate | picker`. Anonymous + ready → `<ResultsGate>`: "Your songs are
   ready" + GoogleButton, NOTHING from the list; `loadPicker`, signed playback URL and
   `markSubmissionViewed` are not called. Log `results_gate_viewed`.
9. `components/ResultsGate.tsx` (new): tap → `POST /api/claim` → `signInWithGoogle('/results/<id>')`.
10. `app/api/claim/route.ts` (new): anon viewer only; random token, store sha256 in
    `creators.claim_token_hash`, cookie `sf_claim` httpOnly, Secure, SameSite=Lax, path=/, 1 h.
11. `app/auth/callback/route.ts`: after exchange + ensureCreator, if `sf_claim` cookie → `claim_anonymous`
    → `results_gate_signed_in {moved}` → delete cookie → redirect `next` (already `safeNext`). `signed_up`
    logic unchanged (Google user's row is new).
12. Picker/preview/feedback/events routes: unchanged — `getCreator()` returns null for anon, so they 401.
    The Deezer sample route cannot load before sign-in; status polling uses `getViewer`, so it works.

## RLS

All policies (0003) are `to authenticated using (auth.uid() = …)`; storage insert/select check
`foldername[1] = auth.uid()`. Anonymous users are `authenticated` with a uid, so uploads (signed URL
and TUS bearer) and own-row reads work unchanged. No restrictive `is_anonymous` policy needed.

## Events (add to DATA_MODEL first)

`anon_session_started` (creator = anon id; via `/api/landing-events`, session required),
`results_gate_viewed` (submission set), `results_gate_signed_in` (metadata.moved).

## Admin metrics rule

A creator counts only when `creators.email is not null`. Funnel `creators` = distinct
`submissions.creator_id` joined to events by `submission_id`, filtered on email not null — so pipeline
events logged under the anon id before the claim (or during an in-flight run after it) still count for
the real creator, and unclaimed runs count as submissions but never as creators.

## Abuse caps

- 3 submissions / 24 h per anon uid (DB count, `checkUploadRate`).
- Per IP: Supabase's anon sign-in limit is DB-enforced across instances. Lower it from 30/h to 10/h
  (carrier NAT shares IPs; 5 is too tight). Worst case 30 runs/h/IP. CAPTCHA would need a secret
  Dylan enters — deferred; noted risk.

## Dashboard (Dylan)

1. Authentication → Sign In / Providers → "Allow anonymous sign-ins" ON (docs: /dashboard/project/_/auth/providers).
2. Authentication → Rate Limits → anonymous sign-ins: 10 per hour (docs: /dashboard/project/_/auth/rate-limits).
"Allow manual linking" (same Sign In / Providers page per the docs link, not "Settings") is NOT needed
with the one-path design; only for Option B.

## Tests

Unit (Vitest, first): `gateDecision` (anon+ready→gate, anon+running→waiting, google→picker, other
owner→not found); `checkUploadRate` 3 for anon, 10 for Google; callback skips claim without cookie. Integration via `exec_sql` fixture: `claim_anonymous` moves rows once, second
call returns 0, refuses a non-anonymous source.

Manual E2E (phone width, real keys), run by Claude before Dylan:
1. Private window, new Google account: choose video → upload starts, no sign-in → wait → gate shows,
   no song titles in page source → Google → picker on the same URL. Admin: one creator, events moved.
2. Second private window, Dylan's EXISTING Google account: same steps → picker; `/results/latest` shows
   it; admin shows Dylan's creator, not a new one.
3. Leave at the gate → admin: submission ready, not a creator.
4. Fourth anon upload in 24 h → "Sign in to upload more."
5. Signed-in creator: normal UploadForm, no gate.

## Estimate

~9 h: migration + SQL 1.5, viewer + routes 1.5, landing auto-start 1, gate + claim + callback 1.5,
metrics 0.5, tests 1.5, phone E2E + review fixes 1.5. Option B: +2 h.

## Risks (ranked)

1. Trigger/NOT NULL break: any mistake in 0009 breaks ALL sign-ups. Test `pnpm db:reset` + both E2E paths.
2. Claim cookie lost (Google opened in another browser, cookie blocked) → songs stay on the anon uid.
   Mitigation: gate keeps working while the anon session lives; admin can run `claim_anonymous` by hand.
3. Abuse/spend: anon runs cost model calls; caps above, no CAPTCHA.
4. In-app browsers: must stay on InAppNotice, or runs are orphaned.
5. Orphan storage/auth rows: cheap now.

## If it must be cut

Ship tomorrow, not tonight. Cut first: `autoStart` (keep one "Find my songs" tap, which keeps vibe chips),
`results_gate_viewed`, metrics tweak (count manually). Never cut: migration, claim, picker 401 for anon.
