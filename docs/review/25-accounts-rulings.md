# Accounts: rulings on Codex's review (2026-10-09)

Plan: `docs/review/24-request-to-codex-accounts.md`. Codex's verdict: ship history and allowance now, defer
self-service deletion until its lifecycle is safe.

| Codex point | Ruling |
|---|---|
| Account deletion must delete the account's events, not blank ids; log `account_deleted` only after success | **Accepted** (applies to batch 2 and the operator script) |
| Typed DELETE for account, two taps for one video; server-side confirm, same-origin check, separate delete rate bucket | **Accepted** (batch 2) |
| No 20 `<video>` thumbnails; use the chosen song's artwork or a neutral placeholder | **Accepted** (batch 1) |
| Render uploads-left server-side; rolling 24 h wording | **Accepted**: "7 uploads left" with "Resets 24 hours after each upload" as a small hint; the cap message changes from "Come back tomorrow" accordingly |
| Deleting videos would restore allowance and bypass the caps | **Accepted**: batch 2 adds an append-only `usage` ledger (migration) and the caps count it instead of submissions, BEFORE any delete ships |
| Operator cleanup bugs (shared refs, nested playback objects, anonymous-user authority from a folder) | **Accepted**: fixed now in batch 1, tests for each |
| "Nothing else" is false | **Accepted**: "Your account details, uploaded videos, the analysis of them, song results and activity. See Privacy." |
| Stable ordering (created_at, id), cursor pagination, Delete outside the row link | **Accepted** |
| Deletion races with in-flight runs | **Accepted**: batch 2 only allows deleting a submission whose status is `ready` or `failed`; account deletion refuses while any run is in flight ("Wait for your current video to finish") |

## Batches

1. **Now:** My Songfits (`/account`), entry links, accurate storage block, uploads left, operator cleanup
   fixes. No migration.
2. **Next (needs a db:push):** usage ledger + caps on it; delete a video; delete my account; events
   deleted with the account; deletion tests (partial storage failure, auth failure, retry, claimed
   anonymous folders, shared paths, in-flight refusal).
