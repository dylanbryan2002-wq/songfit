## Phase 4 — Feedback, paywall, admin metrics, launch

**Demo when done:** on thissongfits.com from a phone: upload → results → "Use this" → offer → pay (Stripe test mode) → thanks (entitlement confirmed) → second upload allowed. A second creator who has not paid hits `/subscribe` on their second upload. `/admin/metrics` shows the funnel with distinct creators and distinct submissions.

Assumes Phases 0–3 are merged. From Phase 0 (migrations 0001–0003 and queries): `recommendations.selected` / `recommendations.rejected`, `stripe_events(id, type, processed_at)`, `submissions.updated_at` + trigger, SQL functions `create_submission()` and `claim_submission_run()`, queries `recordStripeEvent(id, type)`, `markRecommendationFeedback(submissionId, rank, { selected?, rejected? })` (selecting a rank clears `selected` on the other ranks), `listRecommendations(submissionId)`, `getSubmission`, `getActiveSubscription`, `activateSubscription`, `listSubmissions`, `insertEvent`, and `logger` from `src/shared/logger.ts`. From Phase 1: Task 1.7 did the first Vercel deploy, the submit route runs the pipeline via `waitUntil(runSubmission(id))`, `getCreator()` / `requireAdmin()`. From Phase 3: `GET /api/submissions/[id]` returns `RecommendationView[]` (with `selected`/`rejected`), `RecommendationCard` takes `{ rec, chosen, collapsed, onSelect, onReject }`, the admin queue and inspector exist, and the queue already highlights failed rows with their error text and a Retry form.

Rulings applied in this phase (see `docs/review/03-claude-rulings.md`): C4 (Stripe order and validation), C5 (`RecommendationView` DTO), I7 (metrics correctness), I10 (honest billing/feedback UX), M1 (queue polish cut), M2 (hosted Supabase, metrics grants), M3 (admin gate per page/action, no raw errors, retention disclosure).

Migration numbering after Phase 0 ships 0001–0003: this phase adds only `0004_metrics.sql` (Task 4.5). There is no feedback migration.

---

### Task 4.1: Feedback actions and API route

**Files:**
- Create: `src/feedback/actions.ts`
- Create: `app/api/submissions/[id]/feedback/route.ts`
- Modify: `src/db/queries/events.ts` (add `hasEvent`)
- Test: `tests/feedback/actions.test.ts`

No migration: `recommendations.selected`, `recommendations.rejected` and `stripe_events` were created in Phase 0 (`0001_init.sql`). If `pnpm db:types` output lacks `selected` on `recommendations`, stop and fix Phase 0 Task 0.3 first.

**Interfaces:**
- Consumes: `logEvent({ name, creatorId, submissionId, metadata })` from `src/feedback/events.ts`; `getSubmission(id)` → `{ id, creator_id, status, ... } | null`; `markRecommendationFeedback(submissionId, rank, patch)` from `src/db/queries/recommendations.ts` — returns the number of rows updated (`Promise<number>`); `insertEvent` / `createServiceClient()`; `getCreator()`.
- Produces:
  ```ts
  // src/db/queries/events.ts
  export async function hasEvent(submissionId: string, name: EventName, metadata?: Record<string, unknown>): Promise<boolean>;
  // src/feedback/actions.ts
  export type Rank = 1 | 2 | 3;
  export type FeedbackAction = "select" | "reject" | "all_rejected";
  export class FeedbackError extends Error { status: 403 | 404 }
  export async function selectRecommendation(submissionId: string, rank: Rank, creatorId: string): Promise<void>;
  export async function rejectRecommendation(submissionId: string, rank: Rank, creatorId: string): Promise<void>;
  export async function allRejected(submissionId: string, creatorId: string): Promise<void>;
  ```
  Route: `POST /api/submissions/[id]/feedback` body `{ action: "select" | "reject"; rank: 1|2|3 } | { action: "all_rejected" }` → `204`; `400` bad body; `401` signed out; `403` not owner; `404` no submission or no such recommendation. Offer events are NOT on this route (Task 4.3 adds `/api/offer-events`).

- [ ] **Step 1: Write the failing test**

`tests/feedback/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const markRecommendationFeedback = vi.fn();
const getSubmission = vi.fn();
const hasEvent = vi.fn();
const logEvent = vi.fn();
vi.mock("@/src/db/queries/recommendations", () => ({ markRecommendationFeedback }));
vi.mock("@/src/db/queries/submissions", () => ({ getSubmission }));
vi.mock("@/src/db/queries/events", () => ({ hasEvent }));
vi.mock("@/src/feedback/events", () => ({ logEvent }));

import { selectRecommendation, rejectRecommendation, allRejected, FeedbackError } from "@/src/feedback/actions";

const owned = { id: "sub-1", creator_id: "cre-1", status: "ready" };

describe("feedback actions", () => {
  beforeEach(() => {
    markRecommendationFeedback.mockReset().mockResolvedValue(1);
    getSubmission.mockReset().mockResolvedValue(owned);
    hasEvent.mockReset().mockResolvedValue(false);
    logEvent.mockReset();
  });

  it("select marks the row exclusively and logs recommendation_selected with creator and rank", async () => {
    await selectRecommendation("sub-1", 2, "cre-1");
    expect(markRecommendationFeedback).toHaveBeenCalledWith("sub-1", 2, { selected: true, rejected: false });
    expect(logEvent).toHaveBeenCalledWith({ name: "recommendation_selected", creatorId: "cre-1", submissionId: "sub-1", metadata: { rank: 2 } });
  });

  it("select does not log twice for the same submission and rank", async () => {
    hasEvent.mockResolvedValue(true);
    await selectRecommendation("sub-1", 2, "cre-1");
    expect(markRecommendationFeedback).toHaveBeenCalledTimes(1);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("reject marks the row and logs recommendation_rejected", async () => {
    await rejectRecommendation("sub-1", 3, "cre-1");
    expect(markRecommendationFeedback).toHaveBeenCalledWith("sub-1", 3, { rejected: true, selected: false });
    expect(logEvent).toHaveBeenCalledWith({ name: "recommendation_rejected", creatorId: "cre-1", submissionId: "sub-1", metadata: { rank: 3 } });
  });

  it("refuses a submission owned by someone else before touching anything", async () => {
    getSubmission.mockResolvedValue({ ...owned, creator_id: "someone-else" });
    await expect(selectRecommendation("sub-1", 1, "cre-1")).rejects.toBeInstanceOf(FeedbackError);
    expect(markRecommendationFeedback).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("does not log when no recommendation row was updated", async () => {
    markRecommendationFeedback.mockResolvedValue(0);
    await expect(selectRecommendation("sub-1", 1, "cre-1")).rejects.toMatchObject({ status: 404 });
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("allRejected logs all_rejected then more_like_this_requested with the creator", async () => {
    await allRejected("sub-1", "cre-1");
    expect(logEvent.mock.calls.map((c) => c[0])).toEqual([
      { name: "all_rejected", creatorId: "cre-1", submissionId: "sub-1" },
      { name: "more_like_this_requested", creatorId: "cre-1", submissionId: "sub-1" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/feedback/actions.test.ts`
Expected: FAIL — `Cannot find module '@/src/feedback/actions'`.

- [ ] **Step 3: Add `hasEvent` to the events query**

Append to `src/db/queries/events.ts`:

```ts
/** True when an event with this name (and, if given, this exact metadata) already exists for the submission. */
export async function hasEvent(
  submissionId: string,
  name: EventName,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  let q = createServiceClient()
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submissionId)
    .eq("name", name);
  if (metadata) q = q.contains("metadata", metadata);
  const { count, error } = await q;
  if (error) throw error;
  return (count ?? 0) > 0;
}
```

(`EventName` is already imported in that file from `@/src/feedback/events`; if not, add `import type { EventName } from "@/src/feedback/events";`.)

- [ ] **Step 4: Write the actions**

`src/feedback/actions.ts`:

```ts
import { markRecommendationFeedback } from "@/src/db/queries/recommendations";
import { getSubmission } from "@/src/db/queries/submissions";
import { hasEvent } from "@/src/db/queries/events";
import { logEvent } from "@/src/feedback/events";

export type Rank = 1 | 2 | 3;
export type FeedbackAction = "select" | "reject" | "all_rejected";

export class FeedbackError extends Error {
  constructor(public status: 403 | 404, message: string) {
    super(message);
  }
}

/** Throws unless the submission exists and belongs to the creator. Runs before any write or log. */
async function assertOwned(submissionId: string, creatorId: string): Promise<void> {
  const submission = await getSubmission(submissionId);
  if (!submission) throw new FeedbackError(404, "submission not found");
  if (submission.creator_id !== creatorId) throw new FeedbackError(403, "not your submission");
}

export async function selectRecommendation(submissionId: string, rank: Rank, creatorId: string): Promise<void> {
  await assertOwned(submissionId, creatorId);
  // Exclusive: the query clears `selected` on the other ranks in the same statement.
  const updated = await markRecommendationFeedback(submissionId, rank, { selected: true, rejected: false });
  if (updated === 0) throw new FeedbackError(404, "no such recommendation");
  if (await hasEvent(submissionId, "recommendation_selected", { rank })) return;
  await logEvent({ name: "recommendation_selected", creatorId, submissionId, metadata: { rank } });
}

export async function rejectRecommendation(submissionId: string, rank: Rank, creatorId: string): Promise<void> {
  await assertOwned(submissionId, creatorId);
  const updated = await markRecommendationFeedback(submissionId, rank, { rejected: true, selected: false });
  if (updated === 0) throw new FeedbackError(404, "no such recommendation");
  if (await hasEvent(submissionId, "recommendation_rejected", { rank })) return;
  await logEvent({ name: "recommendation_rejected", creatorId, submissionId, metadata: { rank } });
}

export async function allRejected(submissionId: string, creatorId: string): Promise<void> {
  await assertOwned(submissionId, creatorId);
  if (await hasEvent(submissionId, "all_rejected")) return;
  await logEvent({ name: "all_rejected", creatorId, submissionId });
  await logEvent({ name: "more_like_this_requested", creatorId, submissionId });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/feedback/actions.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Write the route**

`app/api/submissions/[id]/feedback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { selectRecommendation, rejectRecommendation, allRejected, FeedbackError } from "@/src/feedback/actions";
import { logger } from "@/src/shared/logger";

const Rank = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select"), rank: Rank }),
  z.object({ action: z.literal("reject"), rank: Rank }),
  z.object({ action: z.literal("all_rejected") }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    const body = parsed.data;
    if (body.action === "select") await selectRecommendation(id, body.rank, creator.id);
    else if (body.action === "reject") await rejectRecommendation(id, body.rank, creator.id);
    else await allRejected(id, creator.id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof FeedbackError) return NextResponse.json({ error: e.message }, { status: e.status });
    logger.error("feedback.failed", { submissionId: id, err: String(e) });
    return NextResponse.json({ error: "feedback_failed" }, { status: 500 }); // generic: no raw error text to creators
  }
}
```

- [ ] **Step 7: Typecheck and manual check**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass.

With `pnpm dev` up and a signed-in browser, in the console on a ready `/results/<id>`:

```js
await fetch(location.pathname.replace("/results/", "/api/submissions/") + "/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "select", rank: 1 }) }).then(r => r.status)
```
Expected: `204`; in Supabase Studio the rank-1 row has `selected = true`, ranks 2–3 have `selected = false`, and `events` has exactly one `recommendation_selected` row with `creator_id` set even after running the snippet twice.

- [ ] **Step 8: Commit**

```bash
git add src/feedback/actions.ts src/db/queries/events.ts app/api/submissions/[id]/feedback/route.ts tests/feedback/actions.test.ts
git commit -m "Add owned, idempotent feedback actions and API route"
```

---

### Task 4.2: Results state reducer and client wiring

**Files:**
- Create: `src/feedback/resultsState.ts`
- Create: `components/ResultsClient.tsx`
- Modify: `app/results/[id]/page.tsx` (render `ResultsClient` instead of mapping cards directly)
- Test: `tests/feedback/resultsState.test.ts`

**Interfaces:**
- Consumes: `RecommendationView` from `@/src/shared/types` (fields `rank, direction_label, title, artist, start_seconds, end_seconds, explanation, artwork_url, preview_url, spotify_url, selected, rejected`); `RecommendationCard` props `{ rec: RecommendationView; chosen: boolean; collapsed: boolean; onSelect: (rank) => void; onReject: (rank) => void }` (Phase 3); `Offer` from Task 4.3 (stub in Step 7 if executed first).
- Produces:
  ```ts
  // src/feedback/resultsState.ts
  export type Rank = 1 | 2 | 3;
  export type ResultsState = { chosen: Rank | null; rejected: Rank[]; showOffer: boolean; allRejected: boolean };
  export type ResultsAction = { type: "select"; rank: Rank } | { type: "reject"; rank: Rank };
  export function initialResultsState(recs: { rank: Rank; selected: boolean; rejected: boolean }[]): ResultsState;
  export function nextResultsState(state: ResultsState, action: ResultsAction): ResultsState;
  ```
  State is derived from the server's `selected`/`rejected` flags on load, so a refresh shows the same choice.

- [ ] **Step 1: Write the failing test**

`tests/feedback/resultsState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { initialResultsState, nextResultsState } from "@/src/feedback/resultsState";

const fresh = () => initialResultsState([
  { rank: 1, selected: false, rejected: false },
  { rank: 2, selected: false, rejected: false },
  { rank: 3, selected: false, rejected: false },
]);

describe("results state", () => {
  it("select sets chosen and shows the offer", () => {
    const s = nextResultsState(fresh(), { type: "select", rank: 2 });
    expect(s.chosen).toBe(2);
    expect(s.showOffer).toBe(true);
    expect(s.allRejected).toBe(false);
  });

  it("selecting another rank replaces the choice (exclusive)", () => {
    let s = nextResultsState(fresh(), { type: "select", rank: 1 });
    s = nextResultsState(s, { type: "select", rank: 3 });
    expect(s.chosen).toBe(3);
  });

  it("rejecting one does not show the offer; rejecting all three does", () => {
    let s = nextResultsState(fresh(), { type: "reject", rank: 1 });
    expect(s.showOffer).toBe(false);
    s = nextResultsState(s, { type: "reject", rank: 2 });
    s = nextResultsState(s, { type: "reject", rank: 3 });
    expect(s.allRejected).toBe(true);
    expect(s.showOffer).toBe(true);
  });

  it("rejecting the chosen pick clears the choice", () => {
    let s = nextResultsState(fresh(), { type: "select", rank: 1 });
    s = nextResultsState(s, { type: "reject", rank: 1 });
    expect(s.chosen).toBeNull();
    expect(s.rejected).toEqual([1]);
  });

  it("initial state reflects a selection persisted on the server (refresh)", () => {
    const s = initialResultsState([
      { rank: 1, selected: false, rejected: true },
      { rank: 2, selected: true, rejected: false },
      { rank: 3, selected: false, rejected: false },
    ]);
    expect(s.chosen).toBe(2);
    expect(s.rejected).toEqual([1]);
    expect(s.showOffer).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/feedback/resultsState.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the reducer**

`src/feedback/resultsState.ts`:

```ts
export type Rank = 1 | 2 | 3;
export type ResultsState = { chosen: Rank | null; rejected: Rank[]; showOffer: boolean; allRejected: boolean };
export type ResultsAction = { type: "select"; rank: Rank } | { type: "reject"; rank: Rank };

export function initialResultsState(recs: { rank: Rank; selected: boolean; rejected: boolean }[]): ResultsState {
  const chosen = recs.find((r) => r.selected)?.rank ?? null;
  const rejected = recs.filter((r) => r.rejected).map((r) => r.rank).sort((a, b) => a - b);
  const allRejected = chosen === null && rejected.length === 3;
  return { chosen, rejected, showOffer: chosen !== null || allRejected, allRejected };
}

export function nextResultsState(state: ResultsState, action: ResultsAction): ResultsState {
  if (action.type === "select") {
    const rejected = state.rejected.filter((r) => r !== action.rank);
    return { chosen: action.rank, rejected, showOffer: true, allRejected: false };
  }
  const rejected = state.rejected.includes(action.rank) ? state.rejected : [...state.rejected, action.rank].sort((a, b) => a - b);
  const chosen = state.chosen === action.rank ? null : state.chosen;
  const allRejected = chosen === null && rejected.length === 3;
  return { chosen, rejected, allRejected, showOffer: state.showOffer || allRejected };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/feedback/resultsState.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the client wrapper**

`components/ResultsClient.tsx`:

```tsx
"use client";
import { useReducer, useCallback } from "react";
import type { RecommendationView } from "@/src/shared/types";
import { initialResultsState, nextResultsState, type Rank } from "@/src/feedback/resultsState";
import { RecommendationCard } from "@/components/RecommendationCard";
import { Offer } from "@/components/Offer";

type Props = { submissionId: string; recs: RecommendationView[]; creatorEmail: string; creatorId: string };

async function post(submissionId: string, body: Record<string, unknown>) {
  await fetch(`/api/submissions/${submissionId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined); // best-effort for the UI; the server is the record
}

export function ResultsClient({ submissionId, recs, creatorEmail, creatorId }: Props) {
  const [state, dispatch] = useReducer(nextResultsState, recs, initialResultsState);

  const onSelect = useCallback((rank: Rank) => {
    dispatch({ type: "select", rank });
    void post(submissionId, { action: "select", rank });
  }, [submissionId]);

  const onReject = useCallback((rank: Rank) => {
    const next = nextResultsState(state, { type: "reject", rank });
    dispatch({ type: "reject", rank });
    void post(submissionId, { action: "reject", rank });
    if (next.allRejected && !state.allRejected) void post(submissionId, { action: "all_rejected" });
  }, [submissionId, state]);

  const ordered = [...recs].sort((a, b) => a.rank - b.rank);

  return (
    <div className="flex flex-col gap-4">
      {ordered.map((rec) => (
        <RecommendationCard
          key={rec.rank}
          rec={rec}
          onSelect={onSelect}
          onReject={onReject}
          chosen={state.chosen === rec.rank}
          collapsed={state.chosen !== null && state.chosen !== rec.rank}
        />
      ))}
      {state.allRejected && (
        <p className="text-center text-lg font-medium">Want 3 different directions?</p>
      )}
      {state.showOffer && (
        <Offer submissionId={submissionId} creatorEmail={creatorEmail} creatorId={creatorId} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Wire it into the results page**

In `app/results/[id]/page.tsx`, replace the block where Phase 3 maps `recommendations` to three `RecommendationCard`s with:

```tsx
<ResultsClient
  submissionId={submission.id}
  recs={recommendations}
  creatorEmail={creator.email}
  creatorId={creator.id}
/>
```

and add `import { ResultsClient } from "@/components/ResultsClient";`. The page already has `creator` from `getCreator()` and `recommendations: RecommendationView[]` built by Phase 3's `toRecommendationView` mapper (which copies `selected`/`rejected` from the rows). Remove the now-unused `RecommendationCard` import from the page.

- [ ] **Step 7: Temporary Offer stub (only if Task 4.3 is not done yet)**

`components/Offer.tsx`:

```tsx
"use client";
export function Offer(_: { submissionId: string | null; creatorEmail: string; creatorId: string; headline?: string }) {
  return <div className="rounded-2xl border p-6 text-center">Offer goes here.</div>;
}
```

Task 4.3 replaces this file.

- [ ] **Step 8: Typecheck, run, verify in the browser**

Run: `pnpm typecheck && pnpm test`
Expected: pass.

`pnpm dev`, open a ready `/results/<id>` at 390 px wide. Tap "Use this" on #2: #1 and #3 collapse, #2 shows "Your pick", the offer appears. Reload: #2 is still the pick (state came from the server). Tap "Use this" on #3: #3 becomes the pick, #2 collapses. Reload again, tap "Not for me" on all three: "Want 3 different directions?" and the offer appear. In Supabase Studio exactly one recommendation has `selected = true` at any time, and `events` has `recommendation_selected` ×2 (ranks 2 and 3), `recommendation_rejected` ×3, `all_rejected`, `more_like_this_requested`, each with `creator_id`.

- [ ] **Step 9: Commit**

```bash
git add src/feedback/resultsState.ts components/ResultsClient.tsx components/Offer.tsx app/results/[id]/page.tsx tests/feedback/resultsState.test.ts
git commit -m "Wire results feedback with server-derived state and exclusive selection"
```

---

### Task 4.3: Offer component, offer events and paywall pages

**Files:**
- Create (replace stub): `components/Offer.tsx`
- Create: `src/billing/paymentLink.ts`
- Create: `app/api/offer-events/route.ts`
- Create: `app/api/me/subscription/route.ts`
- Create: `app/subscribe/page.tsx`
- Create: `app/subscribe/thanks/page.tsx`
- Create: `components/ThanksClient.tsx`
- Modify: `.env.example` (add `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`, `NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL`)
- Test: `tests/billing/paymentLink.test.ts`

**Interfaces:**
- Consumes: `getCreator()`; `getActiveSubscription(creatorId)` → row or null; `logEvent`; `UploadForm` already redirects to `/subscribe` when `POST /api/upload-url` returns 402 (Phase 1). Sign-in is the first tap on `/` (Phase 1, ruling I6), so `/subscribe` can simply redirect signed-out users to `/`.
- Produces:
  ```ts
  // src/billing/paymentLink.ts
  export function buildPaymentLink(base: string, creatorEmail: string, creatorId: string): string;
  // components/Offer.tsx
  export function Offer(props: { submissionId: string | null; creatorEmail: string; creatorId: string; headline?: string }): JSX.Element;
  // POST /api/offer-events  body { action: "offer_viewed" | "offer_clicked"; submissionId?: string } → 204 | 400 | 401
  // GET  /api/me/subscription → { status: "active" | "canceled" | "past_due" | "none" }
  ```
  Env: `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`, `NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL` (both public Stripe URLs; `NEXT_PUBLIC_` lets client components read them).

- [ ] **Step 1: Write the failing test**

`tests/billing/paymentLink.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPaymentLink } from "@/src/billing/paymentLink";

describe("buildPaymentLink", () => {
  it("appends prefilled_email and client_reference_id", () => {
    const url = buildPaymentLink("https://buy.stripe.com/test_abc", "a+b@x.com", "11111111-2222-3333-4444-555555555555");
    expect(url).toBe("https://buy.stripe.com/test_abc?prefilled_email=a%2Bb%40x.com&client_reference_id=11111111-2222-3333-4444-555555555555");
  });
  it("uses & when the base already has a query", () => {
    const url = buildPaymentLink("https://buy.stripe.com/test_abc?locale=en", "a@x.com", "id");
    expect(url.startsWith("https://buy.stripe.com/test_abc?locale=en&prefilled_email=")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/billing/paymentLink.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

`src/billing/paymentLink.ts`:

```ts
export function buildPaymentLink(base: string, creatorEmail: string, creatorId: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}prefilled_email=${encodeURIComponent(creatorEmail)}&client_reference_id=${encodeURIComponent(creatorId)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/billing/paymentLink.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Offer events route (creator-level, submission optional)**

`app/api/offer-events/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";

const Body = z.object({
  action: z.enum(["offer_viewed", "offer_clicked"]),
  submissionId: z.string().uuid().optional(),
});

const NAME = { offer_viewed: "paid_offer_viewed", offer_clicked: "paid_offer_clicked" } as const;

export async function POST(req: Request) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  // Attach the submission only when it is the caller's; never trust a foreign id.
  let submissionId: string | null = null;
  if (parsed.data.submissionId) {
    const s = await getSubmission(parsed.data.submissionId);
    if (s && s.creator_id === creator.id) submissionId = s.id;
  }
  await logEvent({ name: NAME[parsed.data.action], creatorId: creator.id, submissionId });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 6: Subscription status route**

`app/api/me/subscription/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCreator } from "@/src/auth/session";
import { getActiveSubscription } from "@/src/db/queries/subscriptions";

export const dynamic = "force-dynamic";

export async function GET() {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sub = await getActiveSubscription(creator.id);
  return NextResponse.json({ status: sub ? "active" : "none" });
}
```

(`getActiveSubscription` returns only rows with `status = 'active'`, so anything else reads as `none` here; the webhook keeps the row's true status.)

- [ ] **Step 7: Write the Offer component**

`components/Offer.tsx` (replaces the Task 4.2 stub):

```tsx
"use client";
import { useEffect, useRef } from "react";
import { buildPaymentLink } from "@/src/billing/paymentLink";

type Props = { submissionId: string | null; creatorEmail: string; creatorId: string; headline?: string };

function track(action: "offer_viewed" | "offer_clicked", submissionId: string | null) {
  void fetch("/api/offer-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submissionId ? { action, submissionId } : { action }),
    keepalive: true,
  }).catch(() => undefined);
}

export function Offer({ submissionId, creatorEmail, creatorId, headline = "Want Songfit for your next posts?" }: Props) {
  const base = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL ?? "";
  const portal = process.env.NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL ?? "";
  const href = base ? buildPaymentLink(base, creatorEmail, creatorId) : "#";
  const viewed = useRef(false);

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track("offer_viewed", submissionId);
  }, [submissionId]);

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
      <h2 className="text-xl font-semibold tracking-tight">{headline}</h2>
      <p className="mt-2 text-neutral-600">$9.99/month, cancel anytime.</p>
      <a
        href={href}
        onClick={() => track("offer_clicked", submissionId)}
        className="mt-5 inline-block w-full rounded-full bg-black px-6 py-3 text-base font-medium text-white"
      >
        Get Songfit
      </a>
      {portal && (
        <p className="mt-3 text-xs text-neutral-500">
          Already subscribed? <a href={portal} className="underline">Manage or cancel</a>
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 8: Write the paywall pages**

`app/subscribe/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCreator } from "@/src/auth/session";
import { Offer } from "@/components/Offer";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

export default async function SubscribePage() {
  const creator = await getCreator();
  if (!creator) redirect("/"); // sign-in is the first tap on the upload screen (Phase 1)
  const portal = process.env.NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL ?? "";
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <p className="text-center text-neutral-700">You&apos;ve used your free Songfit. Subscribe to keep going.</p>
      <Offer submissionId={null} creatorEmail={creator.email} creatorId={creator.id} headline="Songfit for every post" />
      {portal && (
        <p className="text-center text-xs text-neutral-500">
          <a href={portal} className="underline">Manage or cancel</a> an existing subscription.
        </p>
      )}
    </main>
  );
}
```

`components/ThanksClient.tsx` (polls entitlement; "You're in" only when the webhook has landed):

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Phase = "checking" | "active" | "slow";

export function ThanksClient() {
  const [phase, setPhase] = useState<Phase>("checking");

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await fetch("/api/me/subscription", { cache: "no-store" });
        const j = (await r.json()) as { status?: string };
        if (j.status === "active") { setPhase("active"); return; }
      } catch { /* keep polling */ }
      if (Date.now() - started > 60_000) { setPhase("slow"); return; }
      setTimeout(tick, 2_000);
    };
    void tick();
    return () => { cancelled = true; };
  }, []);

  if (phase === "active") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">You&apos;re in.</h1>
        <p className="text-neutral-700">Upload your next video.</p>
        <Link href="/" className="rounded-full bg-black px-6 py-3 font-medium text-white">Find my songs</Link>
      </>
    );
  }
  if (phase === "slow") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Payment received.</h1>
        <p className="text-neutral-700">Taking longer than expected — refresh in a minute.</p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Payment received.</h1>
      <p className="text-neutral-700">Activating…</p>
    </>
  );
}
```

`app/subscribe/thanks/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCreator } from "@/src/auth/session";
import { Logo } from "@/components/Logo";
import { ThanksClient } from "@/components/ThanksClient";

export const dynamic = "force-dynamic";

export default async function ThanksPage() {
  const creator = await getCreator();
  if (!creator) redirect("/");
  const portal = process.env.NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL ?? "";
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <Logo />
      <ThanksClient />
      {portal && (
        <p className="text-xs text-neutral-500"><a href={portal} className="underline">Manage or cancel</a></p>
      )}
    </main>
  );
}
```

- [ ] **Step 9: Env example**

Append to `.env.example` (keep the existing Stripe lines):

```
# Public Stripe URLs (safe to expose)
NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL=https://buy.stripe.com/test_replace_me
NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL=https://billing.stripe.com/p/login/test_replace_me
```

- [ ] **Step 10: Typecheck and verify**

Run: `pnpm typecheck && pnpm test`
Expected: pass.

`pnpm dev`; sign in as a creator who already has one ready submission; tap "Find my songs" with a new file. Expected: redirected to `/subscribe`; `events` gets a `paid_offer_viewed` row with `creator_id` set and `submission_id` null. Tap "Get Songfit": a `paid_offer_clicked` row, and the Stripe test link opens with your email prefilled. Open `/subscribe/thanks` directly without paying: shows "Payment received. Activating…" then after 60 s the "refresh in a minute" line (no "You're in").

- [ ] **Step 11: Commit**

```bash
git add components/Offer.tsx components/ThanksClient.tsx src/billing/paymentLink.ts app/api/offer-events/route.ts app/api/me/subscription/route.ts app/subscribe/page.tsx app/subscribe/thanks/page.tsx .env.example tests/billing/paymentLink.test.ts
git commit -m "Add offer, creator-level offer events, and entitlement-aware subscribe pages"
```

---

### Task 4.4: Stripe webhook

**Files:**
- Create: `src/billing/stripe.ts`
- Create: `app/api/stripe/webhook/route.ts`
- Modify: `src/db/queries/subscriptions.ts` (add `upsertSubscriptionFromStripe`, `getCreatorIdByStripeCustomer`)
- Modify: `src/db/queries/stripeEvents.ts` (ensure `recordStripeEvent` and add `isStripeEventRecorded`)
- Modify: `src/db/queries/events.ts` (reuse `hasEvent`; add `hasCreatorEvent`)
- Test: `tests/billing/stripe.test.ts`

**Interfaces:**
- Consumes: Phase 0's `stripe_events(id text primary key, type text, processed_at timestamptz)` table and `recordStripeEvent(id, type)` query; `subscriptions` table with `stripe_subscription_id text unique` (plain nullable unique constraint — verify in `0001_init.sql`; if it is a partial index, change it in Phase 0 Task 0.3 to `unique` before this task); `logEvent`; `env("STRIPE_SECRET_KEY")`, `env("STRIPE_WEBHOOK_SECRET")`, `env("STRIPE_PRICE_ID")`.
- Produces:
  ```ts
  // src/db/queries/stripeEvents.ts
  export async function isStripeEventRecorded(id: string): Promise<boolean>;
  export async function recordStripeEvent(id: string, type: string): Promise<void>; // AFTER successful processing only
  // src/db/queries/subscriptions.ts
  export type StripeSubStatus = "active" | "canceled" | "past_due";
  export async function upsertSubscriptionFromStripe(input: { creatorId: string; stripeCustomerId: string; stripeSubscriptionId: string; status: StripeSubStatus }): Promise<void>;
  export async function getCreatorIdByStripeCustomer(stripeCustomerId: string): Promise<string | null>;
  // src/db/queries/events.ts
  export async function hasCreatorEvent(creatorId: string, name: EventName, metadata?: Record<string, unknown>): Promise<boolean>;
  // src/billing/stripe.ts
  export function verifyWebhook(rawBody: string, signature: string): Stripe.Event; // throws on bad signature
  export type StripeDeps = {
    isStripeEventRecorded; recordStripeEvent; upsertSubscriptionFromStripe; getCreatorIdByStripeCustomer;
    hasCreatorEvent; logEvent; retrieveSubscription: (id: string) => Promise<Stripe.Subscription>; priceId: string;
  };
  export async function handleStripeEvent(event: Stripe.Event, deps?: Partial<StripeDeps>): Promise<"processed" | "duplicate" | "ignored">;
  ```
  Processing order (C4): check recorded → process (validate, upsert from Stripe's *current* status) → record event id. A throw before recording leaves the event retryable by Stripe.

- [ ] **Step 1: Install stripe**

Run: `pnpm add stripe`
Expected: `stripe` in `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

`tests/billing/stripe.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { handleStripeEvent } from "@/src/billing/stripe";

const PRICE = "price_songfit_999";

function subscription(over: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    items: { data: [{ price: { id: PRICE } }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

function deps(over: Partial<Record<string, unknown>> = {}) {
  return {
    isStripeEventRecorded: vi.fn(async () => false),
    recordStripeEvent: vi.fn(async () => undefined),
    upsertSubscriptionFromStripe: vi.fn(async () => undefined),
    getCreatorIdByStripeCustomer: vi.fn(async () => "cre-by-customer"),
    hasCreatorEvent: vi.fn(async () => false),
    logEvent: vi.fn(async () => undefined),
    retrieveSubscription: vi.fn(async () => subscription()),
    priceId: PRICE,
    ...over,
  };
}

function checkoutEvent(over: Partial<Stripe.Checkout.Session> = {}): Stripe.Event {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        client_reference_id: "cre-1",
        customer: "cus_1",
        subscription: "sub_1",
        payment_status: "paid",
        ...over,
      } as Stripe.Checkout.Session,
    },
  } as unknown as Stripe.Event;
}

function subEvent(type: "customer.subscription.updated" | "customer.subscription.deleted", over: Partial<Stripe.Subscription> = {}): Stripe.Event {
  return { id: `evt_${type}`, type, data: { object: subscription(over) } } as unknown as Stripe.Event;
}

describe("handleStripeEvent", () => {
  it("checkout: validates price, upserts from the live subscription status, logs paid, then records the event", async () => {
    const d = deps();
    const r = await handleStripeEvent(checkoutEvent(), d);
    expect(r).toBe("processed");
    expect(d.retrieveSubscription).toHaveBeenCalledWith("sub_1");
    expect(d.upsertSubscriptionFromStripe).toHaveBeenCalledWith({ creatorId: "cre-1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "active" });
    expect(d.logEvent).toHaveBeenCalledWith({ name: "paid", creatorId: "cre-1", metadata: { stripeSubscriptionId: "sub_1" } });
    const order = [d.upsertSubscriptionFromStripe, d.recordStripeEvent].map((f) => f.mock.invocationCallOrder[0]);
    expect(order[0]).toBeLessThan(order[1]);
    expect(d.recordStripeEvent).toHaveBeenCalledWith("evt_1", "checkout.session.completed");
  });

  it("a failure during activation does NOT record the event (Stripe can retry)", async () => {
    const d = deps({ upsertSubscriptionFromStripe: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(handleStripeEvent(checkoutEvent(), d)).rejects.toThrow("db down");
    expect(d.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("returns duplicate and does nothing when the event id is already recorded", async () => {
    const d = deps({ isStripeEventRecorded: vi.fn(async () => true) });
    expect(await handleStripeEvent(checkoutEvent(), d)).toBe("duplicate");
    expect(d.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
    expect(d.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("checkout with a different price id is ignored (and not activated)", async () => {
    const d = deps({ retrieveSubscription: vi.fn(async () => subscription({ items: { data: [{ price: { id: "price_other" } }] } } as never)) });
    expect(await handleStripeEvent(checkoutEvent(), d)).toBe("ignored");
    expect(d.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
  });

  it("checkout missing client_reference_id is ignored — no email fallback", async () => {
    const d = deps();
    expect(await handleStripeEvent(checkoutEvent({ client_reference_id: null }), d)).toBe("ignored");
    expect(d.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
  });

  it("checkout not paid is ignored", async () => {
    const d = deps();
    expect(await handleStripeEvent(checkoutEvent({ payment_status: "unpaid" }), d)).toBe("ignored");
  });

  it("subscription.updated arriving before checkout upserts from the customer mapping", async () => {
    const d = deps();
    const r = await handleStripeEvent(subEvent("customer.subscription.updated", { status: "past_due" }), d);
    expect(r).toBe("processed");
    expect(d.getCreatorIdByStripeCustomer).toHaveBeenCalledWith("cus_1");
    expect(d.upsertSubscriptionFromStripe).toHaveBeenCalledWith({ creatorId: "cre-by-customer", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "past_due" });
  });

  it("subscription.deleted marks canceled", async () => {
    const d = deps();
    await handleStripeEvent(subEvent("customer.subscription.deleted", { status: "canceled" }), d);
    expect(d.upsertSubscriptionFromStripe).toHaveBeenCalledWith(expect.objectContaining({ status: "canceled" }));
  });

  it("subscription event for an unmapped customer is ignored", async () => {
    const d = deps({ getCreatorIdByStripeCustomer: vi.fn(async () => null) });
    expect(await handleStripeEvent(subEvent("customer.subscription.updated"), d)).toBe("ignored");
    expect(d.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
  });

  it("paid is logged once per subscription id", async () => {
    const d = deps({ hasCreatorEvent: vi.fn(async () => true) });
    await handleStripeEvent(checkoutEvent(), d);
    expect(d.logEvent).not.toHaveBeenCalled();
  });

  it("ignores unknown event types without recording", async () => {
    const d = deps();
    const ev = { id: "evt_x", type: "invoice.paid", data: { object: {} } } as unknown as Stripe.Event;
    expect(await handleStripeEvent(ev, d)).toBe("ignored");
    expect(d.recordStripeEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/billing/stripe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Queries**

`src/db/queries/stripeEvents.ts` (Phase 0 created `recordStripeEvent`; make the file read exactly):

```ts
import "server-only";
import { createServiceClient } from "../client";

export async function isStripeEventRecorded(id: string): Promise<boolean> {
  const { count, error } = await createServiceClient()
    .from("stripe_events")
    .select("id", { count: "exact", head: true })
    .eq("id", id);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** Call ONLY after the event's effects are committed. A duplicate insert (race) is harmless. */
export async function recordStripeEvent(id: string, type: string): Promise<void> {
  const { error } = await createServiceClient()
    .from("stripe_events")
    .insert({ id, type, processed_at: new Date().toISOString() });
  if (error && error.code !== "23505") throw error; // 23505 = already recorded by a concurrent delivery
}
```

Append to `src/db/queries/subscriptions.ts`:

```ts
export type StripeSubStatus = "active" | "canceled" | "past_due";

/** Idempotent: one row per Stripe subscription id, status always taken from Stripe's current object. */
export async function upsertSubscriptionFromStripe(input: {
  creatorId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: StripeSubStatus;
}): Promise<void> {
  const { error } = await createServiceClient()
    .from("subscriptions")
    .upsert(
      {
        creator_id: input.creatorId,
        stripe_customer_id: input.stripeCustomerId,
        stripe_subscription_id: input.stripeSubscriptionId,
        status: input.status,
        started_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id", ignoreDuplicates: false },
    );
  if (error) throw error;
}

export async function getCreatorIdByStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  const { data, error } = await createServiceClient()
    .from("subscriptions")
    .select("creator_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.creator_id ?? null;
}
```

Append to `src/db/queries/events.ts`:

```ts
export async function hasCreatorEvent(creatorId: string, name: EventName, metadata?: Record<string, unknown>): Promise<boolean> {
  let q = createServiceClient()
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .eq("name", name);
  if (metadata) q = q.contains("metadata", metadata);
  const { count, error } = await q;
  if (error) throw error;
  return (count ?? 0) > 0;
}
```

The `onConflict: "stripe_subscription_id"` upsert requires a plain UNIQUE constraint on that column. Confirm with:

Run: `grep -n "stripe_subscription_id" supabase/migrations/0001_init.sql`
Expected: a line containing `stripe_subscription_id text unique`. If it shows a partial index (`create unique index ... where`), change Phase 0's migration to the plain constraint and `pnpm db:push`.

- [ ] **Step 5: Write the Stripe module**

`src/billing/stripe.ts`:

```ts
import Stripe from "stripe";
import { env } from "@/src/shared/config";
import { logger } from "@/src/shared/logger";
import { isStripeEventRecorded as isRecordedDb, recordStripeEvent as recordDb } from "@/src/db/queries/stripeEvents";
import {
  upsertSubscriptionFromStripe as upsertDb,
  getCreatorIdByStripeCustomer as byCustomerDb,
  type StripeSubStatus,
} from "@/src/db/queries/subscriptions";
import { hasCreatorEvent as hasCreatorEventDb } from "@/src/db/queries/events";
import { logEvent as logEventDb } from "@/src/feedback/events";

let client: Stripe | null = null;
function stripe(): Stripe {
  if (!client) client = new Stripe(env("STRIPE_SECRET_KEY"));
  return client;
}

export function verifyWebhook(rawBody: string, signature: string): Stripe.Event {
  return stripe().webhooks.constructEvent(rawBody, signature, env("STRIPE_WEBHOOK_SECRET"));
}

export type StripeDeps = {
  isStripeEventRecorded: typeof isRecordedDb;
  recordStripeEvent: typeof recordDb;
  upsertSubscriptionFromStripe: typeof upsertDb;
  getCreatorIdByStripeCustomer: typeof byCustomerDb;
  hasCreatorEvent: typeof hasCreatorEventDb;
  logEvent: typeof logEventDb;
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
  priceId: string;
};

function defaultDeps(): StripeDeps {
  return {
    isStripeEventRecorded: isRecordedDb,
    recordStripeEvent: recordDb,
    upsertSubscriptionFromStripe: upsertDb,
    getCreatorIdByStripeCustomer: byCustomerDb,
    hasCreatorEvent: hasCreatorEventDb,
    logEvent: logEventDb,
    retrieveSubscription: (id) => stripe().subscriptions.retrieve(id),
    priceId: env("STRIPE_PRICE_ID"),
  };
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

function toStatus(s: Stripe.Subscription.Status): StripeSubStatus {
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  return "canceled";
}

function priceOf(sub: Stripe.Subscription): string | null {
  return sub.items?.data?.[0]?.price?.id ?? null;
}

/**
 * Order matters (ruling C4): duplicate check → process → record. Anything thrown
 * before `recordStripeEvent` leaves the event unrecorded so Stripe's retry re-processes it.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  overrides: Partial<StripeDeps> = {},
): Promise<"processed" | "duplicate" | "ignored"> {
  const deps: StripeDeps = { ...defaultDeps(), ...overrides };

  if (event.type !== "checkout.session.completed" && event.type !== "customer.subscription.updated" && event.type !== "customer.subscription.deleted") {
    logger.info("stripe.ignored_type", { type: event.type });
    return "ignored";
  }
  if (await deps.isStripeEventRecorded(event.id)) return "duplicate";

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const creatorId = s.client_reference_id ?? null;
    const stripeCustomerId = idOf(s.customer);
    const stripeSubscriptionId = idOf(s.subscription);
    if (!creatorId || !stripeCustomerId || !stripeSubscriptionId || s.payment_status !== "paid") {
      logger.warn("stripe.checkout_incomplete", { sessionId: s.id, hasCreator: !!creatorId, paid: s.payment_status });
      return "ignored";
    }
    const sub = await deps.retrieveSubscription(stripeSubscriptionId);
    if (priceOf(sub) !== deps.priceId) {
      logger.warn("stripe.wrong_price", { sessionId: s.id, price: priceOf(sub) });
      return "ignored";
    }
    await deps.upsertSubscriptionFromStripe({ creatorId, stripeCustomerId, stripeSubscriptionId, status: toStatus(sub.status) });
    if (!(await deps.hasCreatorEvent(creatorId, "paid", { stripeSubscriptionId }))) {
      await deps.logEvent({ name: "paid", creatorId, metadata: { stripeSubscriptionId } });
    }
    await deps.recordStripeEvent(event.id, event.type);
    return "processed";
  }

  // customer.subscription.updated | deleted — may arrive before or after checkout.
  const sub = event.data.object as Stripe.Subscription;
  const stripeCustomerId = idOf(sub.customer);
  if (!stripeCustomerId || !sub.id) return "ignored";
  const creatorId = sub.metadata?.creator_id || (await deps.getCreatorIdByStripeCustomer(stripeCustomerId));
  if (!creatorId) {
    logger.warn("stripe.unmapped", { customer: stripeCustomerId, subscription: sub.id });
    return "ignored";
  }
  const status = event.type === "customer.subscription.deleted" ? "canceled" : toStatus(sub.status);
  await deps.upsertSubscriptionFromStripe({ creatorId, stripeCustomerId, stripeSubscriptionId: sub.id, status });
  await deps.recordStripeEvent(event.id, event.type);
  return "processed";
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/billing/stripe.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 7: Write the route**

`app/api/stripe/webhook/route.ts`:

```ts
import { NextResponse } from "next/server";
import { verifyWebhook, handleStripeEvent } from "@/src/billing/stripe";
import { logger } from "@/src/shared/logger";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 400 });
  const raw = await req.text();

  let event;
  try {
    event = verifyWebhook(raw, signature);
  } catch (e) {
    logger.warn("stripe.bad_signature", { message: (e as Error).message });
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    // 500 on purpose: the event is NOT recorded, so Stripe retries and the activation is not lost.
    logger.error("stripe.handler_failed", { id: event.id, type: event.type, message: (e as Error).message });
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 8: Dylan's Stripe setup (do once in test mode, repeat in live mode Wednesday evening)**

- [ ] Stripe Dashboard → Product catalog → Add product → name `Songfit`, recurring, `$9.99` monthly. Save. Open the price and copy its ID (`price_...`) into `STRIPE_PRICE_ID`.
- [ ] Payment Links → New → pick the Songfit price. "Collect customers' email" on. After payment → "Don't show confirmation page" → redirect to `https://thissongfits.com/subscribe/thanks`. Create; copy the link into `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`.
- [ ] Settings → Billing → Customer portal → Activate; allow "Cancel subscriptions". Copy the portal login link (`https://billing.stripe.com/p/login/...`) into `NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL`.
- [ ] Developers → API keys → Secret key into `STRIPE_SECRET_KEY`.
- [ ] Developers → Webhooks → Add endpoint → `https://thissongfits.com/api/stripe/webhook` → events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Signing secret into `STRIPE_WEBHOOK_SECRET` (Vercel). Locally use the CLI secret from Step 9.
- [ ] Add all five values to Vercel env (Production + Preview) and `.env.local`.

- [ ] **Step 9: Local webhook test**

Install the Stripe CLI (download from https://docs.stripe.com/stripe-cli; no Homebrew on this Mac), then:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the printed `whsec_...` into `.env.local` as `STRIPE_WEBHOOK_SECRET`, restart `pnpm dev`, then in another terminal:

```bash
stripe trigger checkout.session.completed
```

Expected: `pnpm dev` logs `stripe.checkout_incomplete` or `stripe.wrong_price` (the trigger has no `client_reference_id` and a random price) and the response is `200 {"received":true,"result":"ignored"}`; no `subscriptions` row is written. Then a real test checkout: from `/subscribe` while signed in, pay with `4242 4242 4242 4242`, any future date, any CVC. Expected: redirect to `/subscribe/thanks` → "Activating…" → within a few seconds "You're in."; `subscriptions` row with `status = active` and your creator id; `stripe_events` row for the event; one `paid` event; a second upload is accepted. Resend the same event from the Stripe dashboard (Webhooks → event → Resend): response `{"result":"duplicate"}`, still one `paid` event.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml src/billing/stripe.ts app/api/stripe/webhook/route.ts src/db/queries/stripeEvents.ts src/db/queries/subscriptions.ts src/db/queries/events.ts tests/billing/stripe.test.ts
git commit -m "Add Stripe webhook: validate, upsert from live status, record event last"
```

---

### Task 4.5: Metrics SQL function, seed fixture and admin metrics page

**Files:**
- Create: `supabase/migrations/0004_metrics.sql`
- Create: `supabase/seed/metrics_fixture.sql`
- Create: `src/db/queries/metrics.ts`
- Create: `src/shared/stats.ts`
- Create: `app/admin/metrics/page.tsx`
- Modify: `app/admin/layout.tsx` (add a "Metrics" nav link)
- Modify: `docs/DATA_MODEL.md` (document `updated_at` on submissions and the `metrics_summary()` function)
- Test: `tests/shared/stats.test.ts`, `tests/db/metrics.integration.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()`; `createServiceClient()`; `submissions.updated_at` (Phase 0).
- Produces:
  ```ts
  // src/shared/stats.ts
  export function median(values: number[]): number | null;
  // src/db/queries/metrics.ts
  export type Metrics = {
    eventCounts: { name: string; count: number }[];
    funnel: { stage: string; submissions: number; creators: number }[];
    medianUploadToReadySeconds: number | null;
    medianReadyToSelectionSeconds: number | null;
    byCategory: { category: string; ready: number; selected: number }[];
    paidCreators: number;
    paidEvents: number;
    returningCreators: number;
  };
  export async function getMetrics(): Promise<Metrics>;
  ```
  SQL function `metrics_summary()` returning one jsonb, executable by `service_role` only.

- [ ] **Step 1: Write the failing unit test**

`tests/shared/stats.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { median } from "@/src/shared/stats";

describe("median", () => {
  it("returns null for empty input", () => expect(median([])).toBeNull());
  it("returns the middle of an odd list", () => expect(median([5, 1, 3])).toBe(3));
  it("averages the two middles of an even list", () => expect(median([1, 2, 3, 4])).toBe(2.5));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/shared/stats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

`src/shared/stats.ts`:

```ts
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/shared/stats.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the migration**

`supabase/migrations/0004_metrics.sql`:

```sql
-- One-shot metrics summary for the admin page. Service role only.
-- Funnel counts DISTINCT submissions and DISTINCT creators per milestone.
-- Category breakdown aggregates submissions first (no event-join multiplication).
create or replace function metrics_summary() returns jsonb
language sql security definer set search_path = public as $$
with
event_counts as (
  select name, count(*)::int as count from events group by name
),
stages as (
  select * from (values
    ('submission_created', 1), ('recommendations_ready', 2), ('recommendations_viewed', 3),
    ('recommendation_selected', 4), ('all_rejected', 4), ('paid_offer_viewed', 5),
    ('paid_offer_clicked', 6), ('paid', 7)
  ) as t(stage, ord)
),
funnel as (
  select s.stage, s.ord,
    count(distinct e.submission_id)::int as submissions,
    count(distinct e.creator_id)::int as creators
  from stages s left join events e on e.name = s.stage
  group by s.stage, s.ord
),
upload_to_ready as (
  select extract(epoch from (recommended_at - created_at)) as secs
  from submissions where recommended_at is not null
),
ready_to_select as (
  select extract(epoch from (min(e.created_at) - s.recommended_at)) as secs
  from events e join submissions s on s.id = e.submission_id
  where e.name = 'recommendation_selected' and s.recommended_at is not null
  group by s.id, s.recommended_at
),
selected_submissions as (
  select distinct submission_id from events where name = 'recommendation_selected'
),
by_category as (
  select coalesce(s.content_category, 'unknown') as category,
    count(*) filter (where s.status = 'ready')::int as ready,
    count(*) filter (where ss.submission_id is not null)::int as selected
  from submissions s left join selected_submissions ss on ss.submission_id = s.id
  group by 1
),
paid as (
  select
    (select count(distinct creator_id)::int from subscriptions where status = 'active') as paid_creators,
    (select count(*)::int from events where name = 'paid') as paid_events
),
returning_creators as (
  select count(*)::int as n from (
    select creator_id from submissions group by creator_id having count(*) >= 2
  ) r
)
select jsonb_build_object(
  'eventCounts', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', count) order by name), '[]'::jsonb) from event_counts),
  'funnel', (select coalesce(jsonb_agg(jsonb_build_object('stage', stage, 'submissions', submissions, 'creators', creators) order by ord, stage), '[]'::jsonb) from funnel),
  'uploadToReadySeconds', (select coalesce(jsonb_agg(secs), '[]'::jsonb) from upload_to_ready),
  'readyToSelectionSeconds', (select coalesce(jsonb_agg(secs), '[]'::jsonb) from ready_to_select),
  'byCategory', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'ready', ready, 'selected', selected) order by ready desc), '[]'::jsonb) from by_category),
  'paidCreators', (select paid_creators from paid),
  'paidEvents', (select paid_events from paid),
  'returningCreators', (select n from returning_creators)
);
$$;

revoke execute on function metrics_summary() from public, anon, authenticated;
grant execute on function metrics_summary() to service_role;
```

Run: `pnpm db:push && pnpm db:types`
Expected (hosted project, see Phase 0 Task 0.3): `supabase db push` applies `0004_metrics.sql`; `src/db/types.ts` gains a `metrics_summary` entry under `Functions`.

- [ ] **Step 6: Document in the data model**

In `docs/DATA_MODEL.md`, add to the `## submissions` table (if Phase 0 did not already):

```markdown
| updated_at        | timestamptz | set by trigger on every update; used by claim_submission_run() for stale takeover |
```

and a new section after `## subscriptions`:

```markdown
## metrics_summary()
SQL function (service role only) returning one jsonb: eventCounts, funnel (distinct submissions + distinct creators per milestone), uploadToReadySeconds[], readyToSelectionSeconds[], byCategory (submissions aggregated before any event join), paidCreators (distinct creators with an active subscription), paidEvents, returningCreators (≥2 submissions). Read by `src/db/queries/metrics.ts`.
```

- [ ] **Step 7: Write the query**

`src/db/queries/metrics.ts`:

```ts
import "server-only";
import { z } from "zod";
import { createServiceClient } from "../client";
import { median } from "@/src/shared/stats";

const Raw = z.object({
  eventCounts: z.array(z.object({ name: z.string(), count: z.number() })),
  funnel: z.array(z.object({ stage: z.string(), submissions: z.number(), creators: z.number() })),
  uploadToReadySeconds: z.array(z.number()),
  readyToSelectionSeconds: z.array(z.number()),
  byCategory: z.array(z.object({ category: z.string(), ready: z.number(), selected: z.number() })),
  paidCreators: z.number(),
  paidEvents: z.number(),
  returningCreators: z.number(),
});

export type Metrics = {
  eventCounts: { name: string; count: number }[];
  funnel: { stage: string; submissions: number; creators: number }[];
  medianUploadToReadySeconds: number | null;
  medianReadyToSelectionSeconds: number | null;
  byCategory: { category: string; ready: number; selected: number }[];
  paidCreators: number;
  paidEvents: number;
  returningCreators: number;
};

export async function getMetrics(): Promise<Metrics> {
  const { data, error } = await createServiceClient().rpc("metrics_summary");
  if (error) throw new Error(`metrics_summary: ${error.message}`);
  const raw = Raw.parse(data);
  return {
    eventCounts: raw.eventCounts,
    funnel: raw.funnel,
    medianUploadToReadySeconds: median(raw.uploadToReadySeconds),
    medianReadyToSelectionSeconds: median(raw.readyToSelectionSeconds),
    byCategory: raw.byCategory,
    paidCreators: raw.paidCreators,
    paidEvents: raw.paidEvents,
    returningCreators: raw.returningCreators,
  };
}
```

- [ ] **Step 8: Seed fixture and integration test**

`supabase/seed/metrics_fixture.sql` (test data only; ids are fixed so the test can clean up):

```sql
-- Two creators, three submissions, repeated events, one paid.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'fixture-a@songfit.test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'fixture-b@songfit.test')
on conflict (id) do nothing;
-- the auth->creators trigger (Phase 0) mirrors these; ensure explicitly:
insert into creators (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'fixture-a@songfit.test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'fixture-b@songfit.test')
on conflict (id) do nothing;

insert into submissions (id, creator_id, video_path, status, content_category, created_at, recommended_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/1.mp4', 'ready', 'fashion', now() - interval '10 min', now() - interval '8 min'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/2.mp4', 'ready', 'fashion', now() - interval '6 min',  now() - interval '4 min'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002/3.mp4', 'ready', 'fitness', now() - interval '5 min',  now() - interval '3 min');

insert into events (creator_id, submission_id, name, metadata, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'submission_created', null, now() - interval '10 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'recommendations_ready', null, now() - interval '8 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'recommendations_viewed', null, now() - interval '7 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'recommendations_viewed', null, now() - interval '7 min'), -- repeated view
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'recommendation_selected', '{"rank":1}', now() - interval '6 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'submission_created', null, now() - interval '6 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'recommendations_ready', null, now() - interval '4 min'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000003', 'submission_created', null, now() - interval '5 min'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000003', 'recommendations_ready', null, now() - interval '3 min'),
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'paid_offer_viewed', null, now() - interval '2 min'),
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'paid', '{"stripeSubscriptionId":"sub_fixture"}', now() - interval '1 min');

insert into subscriptions (creator_id, stripe_customer_id, stripe_subscription_id, status, started_at) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cus_fixture', 'sub_fixture', 'active', now() - interval '1 min')
on conflict (stripe_subscription_id) do nothing;
```

`tests/db/metrics.integration.test.ts` (runs only when a database is configured; it is a real check of the SQL, not a mock):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && key && process.env.RUN_DB_TESTS === "1");

const CREATORS = ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002"];

describe.skipIf(!enabled)("metrics_summary() against the fixture", () => {
  const db = createClient(url ?? "", key ?? "");

  beforeAll(async () => {
    const sql = readFileSync("supabase/seed/metrics_fixture.sql", "utf8");
    const { error } = await db.rpc("exec_sql", { sql }); // helper below
    if (error) throw error;
  });

  afterAll(async () => {
    await db.from("subscriptions").delete().in("creator_id", CREATORS);
    await db.from("events").delete().in("creator_id", CREATORS);
    await db.from("submissions").delete().in("creator_id", CREATORS);
    await db.from("creators").delete().in("id", CREATORS);
  });

  it("counts distinct submissions and creators, aggregates categories once, and reports paid correctly", async () => {
    const { data, error } = await db.rpc("metrics_summary");
    expect(error).toBeNull();
    const m = data as {
      funnel: { stage: string; submissions: number; creators: number }[];
      byCategory: { category: string; ready: number; selected: number }[];
      paidCreators: number; paidEvents: number; returningCreators: number;
    };
    const stage = (s: string) => m.funnel.find((f) => f.stage === s)!;
    expect(stage("submission_created").submissions).toBeGreaterThanOrEqual(3);
    expect(stage("submission_created").creators).toBeGreaterThanOrEqual(2);
    expect(stage("recommendations_ready").creators).toBeGreaterThanOrEqual(2); // creatorId is on ready events now (I7)
    expect(stage("recommendations_viewed").submissions).toBeGreaterThanOrEqual(1); // two view rows, one submission
    const fashion = m.byCategory.find((c) => c.category === "fashion")!;
    expect(fashion.ready).toBeGreaterThanOrEqual(2); // not multiplied by the 5 events on submission 1
    expect(fashion.selected).toBeGreaterThanOrEqual(1);
    expect(m.paidCreators).toBeGreaterThanOrEqual(1);
    expect(m.paidEvents).toBeGreaterThanOrEqual(1);
    expect(m.returningCreators).toBeGreaterThanOrEqual(1);
  });
});
```

The fixture is loaded through a tiny helper function. Add to the top of `supabase/migrations/0004_metrics.sql` (service role only):

```sql
-- Test helper: run a SQL script. Service role only; never exposed to clients.
create or replace function exec_sql(sql text) returns void
language plpgsql security definer set search_path = public as $$
begin execute sql; end $$;
revoke execute on function exec_sql(text) from public, anon, authenticated;
grant execute on function exec_sql(text) to service_role;
```

Run: `RUN_DB_TESTS=1 pnpm vitest run tests/db/metrics.integration.test.ts`
Expected: PASS (1). Without `RUN_DB_TESTS=1` the suite reports it as skipped, so `pnpm test` stays green in CI-less local runs. (`≥` assertions keep the test valid when real data coexists with the fixture on the hosted project.)

- [ ] **Step 9: Write the page**

`app/admin/metrics/page.tsx`:

```tsx
import { requireAdmin } from "@/src/auth/session";
import { getMetrics } from "@/src/db/queries/metrics";

export const dynamic = "force-dynamic";

function secs(v: number | null) {
  return v === null ? "—" : `${Math.round(v)} s`;
}

export default async function MetricsPage() {
  await requireAdmin();
  const m = await getMetrics();
  return (
    <main className="mx-auto max-w-4xl space-y-10 p-6">
      <h1 className="text-2xl font-semibold">Metrics</h1>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Paying creators (active)</div><div className="text-xl">{m.paidCreators}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Paid events</div><div className="text-xl">{m.paidEvents}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Median upload → ready</div><div className="text-xl">{secs(m.medianUploadToReadySeconds)}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Median ready → selection</div><div className="text-xl">{secs(m.medianReadyToSelectionSeconds)}</div></div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Funnel (distinct)</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th>Stage</th><th>Submissions</th><th>Creators</th></tr></thead>
          <tbody>
            {m.funnel.map((f) => (
              <tr key={f.stage} className="border-t"><td>{f.stage}</td><td>{f.submissions}</td><td>{f.creators}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 font-medium">By category</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th>Category</th><th>Ready</th><th>Selected</th><th>Select rate</th></tr></thead>
          <tbody>
            {m.byCategory.map((c) => (
              <tr key={c.category} className="border-t">
                <td>{c.category}</td><td>{c.ready}</td><td>{c.selected}</td>
                <td>{c.ready ? `${Math.round((100 * c.selected) / c.ready)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <p className="text-sm">Returning creators (≥2 uploads): <strong>{m.returningCreators}</strong></p>
      </section>

      <section>
        <h2 className="mb-2 font-medium">All events (raw counts)</h2>
        <table className="w-full text-sm">
          <tbody>
            {m.eventCounts.map((e) => (
              <tr key={e.name} className="border-t"><td>{e.name}</td><td className="text-right">{e.count}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
```

In `app/admin/layout.tsx` add a nav link next to the existing "Queue" link:

```tsx
<a href="/admin/metrics" className="underline">Metrics</a>
```

- [ ] **Step 10: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: pass (integration test skipped unless `RUN_DB_TESTS=1`).

Open `/admin/metrics` as the admin: the four tiles, funnel rows in order `submission_created … paid` with both distinct counts, a category table, returning creators, raw event counts. As a non-admin: redirected (existing `requireAdmin`).

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/0004_metrics.sql supabase/seed/metrics_fixture.sql src/db/types.ts src/db/queries/metrics.ts src/shared/stats.ts app/admin/metrics/page.tsx app/admin/layout.tsx docs/DATA_MODEL.md tests/shared/stats.test.ts tests/db/metrics.integration.test.ts
git commit -m "Add distinct-count metrics function with fixture test and admin metrics page"
```

---

### Task 4.6: Hardening for launch

**Files:**
- Modify: `app/api/upload-url/route.ts` (rate limit)
- Modify: `src/db/queries/submissions.ts` (`countRecentSubmissions`)
- Modify: `next.config.ts` (remote images; keep `serverExternalPackages`)
- Modify: `app/layout.tsx` (viewport, theme-color)
- Modify: `app/page.tsx` (retention disclosure line)
- Modify: `app/admin/page.tsx`, `app/admin/submissions/[id]/page.tsx`, `app/admin/metrics/page.tsx`, `app/admin/submissions/[id]/actions.ts` (each calls `requireAdmin()` itself)
- Create: `app/robots.ts`, `app/error.tsx`, `app/results/[id]/not-found.tsx`
- Test: `tests/db/countRecent.test.ts` is not needed — `countRecentSubmissions` is a thin query verified by typecheck and the manual check below; say so in the report.

No double-run guard here: `claim_submission_run()` (Phase 0) is an atomic conditional update, used by `runSubmission` in both the submit route and the admin retry, with stale takeover after `LIMITS.inFlightStaleMinutes`.

- [ ] **Step 1: Rate-limit upload authorizations**

Append to `src/db/queries/submissions.ts`:

```ts
export async function countRecentSubmissions(creatorId: string, withinMs: number): Promise<number> {
  const since = new Date(Date.now() - withinMs).toISOString();
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .gte("created_at", since);
  if (error) throw error;
  return count ?? 0;
}
```

In `app/api/upload-url/route.ts`, after the creator is resolved and before the `canSubmit` UX check (Phase 1 Task 1.2), add:

```ts
import { countRecentSubmissions } from "@/src/db/queries/submissions";
// ...
if ((await countRecentSubmissions(creator.id, 60_000)) >= 5) {
  return NextResponse.json({ error: "rate_limited" }, { status: 429 });
}
```

(Entitlement itself is enforced atomically by `create_submission()` in `POST /api/submissions`; this limit only stops upload-URL spam.)

- [ ] **Step 2: Config and chrome**

`next.config.ts` — the file must contain BOTH the Phase 0 externals and the image hosts:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  outputFileTracingIncludes: {
    "/api/submissions/**": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/**"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net" },
      { protocol: "https", hostname: "cdn-images.dzcdn.net" },
      { protocol: "https", hostname: "**.mzstatic.com" },
    ],
  },
};

export default nextConfig;
```

(If Phase 0's `next.config.ts` has different externals/tracing keys, keep Phase 0's values and only ADD `images`. Never drop the ffmpeg settings.)

`app/layout.tsx` — add (keep the existing `metadata`):

```tsx
import type { Viewport } from "next";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};
```

`app/robots.ts`:

```ts
import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api"] }] };
}
```

`app/error.tsx` (generic copy; never shows the error message):

```tsx
"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg">Something went wrong, try again.</p>
      <button onClick={reset} className="rounded-full bg-black px-6 py-3 text-white">Try again</button>
    </main>
  );
}
```

`app/results/[id]/not-found.tsx`:

```tsx
import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg">We couldn&apos;t find that Songfit.</p>
      <Link href="/" className="underline">Upload a video</Link>
    </main>
  );
}
```

In `app/results/[id]/page.tsx`, where the submission is loaded, call `notFound()` from `next/navigation` when it is null or belongs to another creator (replace any plain message Phase 3 rendered).

- [ ] **Step 3: Retention disclosure (M3)**

In `app/page.tsx`, under the upload form, add:

```tsx
<p className="mt-6 text-center text-xs text-neutral-500">
  Your video is stored by Songfit and analyzed with third-party AI services to find your songs. Email hello@thissongfits.com to have it deleted.
</p>
```

- [ ] **Step 4: Admin gate on every admin entry (M3)**

Confirm each of `app/admin/page.tsx`, `app/admin/submissions/[id]/page.tsx`, `app/admin/metrics/page.tsx` starts its default export with `await requireAdmin();`, and that `app/admin/submissions/[id]/actions.ts` calls `await requireAdmin();` as the first line of `retrySubmission`. Add it wherever missing. The layout's gate stays, but no page or action depends on it.

Run: `grep -L "requireAdmin" app/admin/page.tsx app/admin/submissions/\[id\]/page.tsx app/admin/metrics/page.tsx app/admin/submissions/\[id\]/actions.ts`
Expected: no output (every file contains the call).

- [ ] **Step 5: No raw errors to creators**

Run: `grep -rn "error.message\|String(e)\|String(err)" app/api app/results app/page.tsx components | grep -v logger`
Expected: no output. Any match that reaches a `NextResponse.json` body or JSX must be replaced with a fixed string (`"something_went_wrong"`) and the detail moved into a `logger.*` call.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all pass; build completes without image-host warnings and the ffmpeg binaries are listed in the function trace (`.next/server/app/api/submissions/...` references `ffmpeg-static`).

Manual: `POST /api/upload-url` six times in a minute from the console → the sixth returns 429. Open `/results/not-a-real-id` → not-found page. `curl -s localhost:3000/robots.txt` shows `Disallow: /admin`. Signed in as a non-admin, open `/admin/metrics` directly → redirected.

- [ ] **Step 7: Commit**

```bash
git add app/api/upload-url/route.ts src/db/queries/submissions.ts next.config.ts app/layout.tsx app/page.tsx app/robots.ts app/error.tsx app/results/[id]/not-found.tsx app/results/[id]/page.tsx app/admin
git commit -m "Harden uploads, admin gating, error pages and config for launch"
```

---

### Task 4.7: Production plans, domain and smoke test

**Files:**
- Modify: `README.md` (Deploy section)
- Modify (only if staying on Supabase Free): `src/shared/config.ts` (`maxUploadBytes`), `components/UploadForm.tsx` copy

The Vercel project and GitHub repo already exist from Phase 1 Task 1.7; this task finishes production.

- [ ] **Step 1: Plans (Dylan decisions, defaults apply)**

- [ ] **Vercel Pro** (default yes, $20/mo): Vercel → Settings → Billing → upgrade. Reason: commercial use is outside Hobby's terms, and Pro gives the 300 s function budget without relying on Fluid Compute. Confirm `maxDuration = 300` on `app/api/submissions/route.ts` (submit route, runs the pipeline) and `app/api/submissions/[id]/run/route.ts` (admin retry).
- [ ] **Supabase Pro** (default yes, $25/mo): Supabase → Settings → Billing → Pro. Then Storage → Settings → global file size limit `150 MB`. Reason: Free caps files at 50 MB; a 3-minute 1080p Reel exceeds it.
  - If Dylan chooses to stay on Free: set `maxUploadBytes: 50 * 1024 * 1024` in `src/shared/config.ts`, change the UploadForm size error to "Videos up to 50 MB for now", and set the Storage limit to 50 MB. Commit that change with message `Cap uploads at 50 MB (Supabase Free)`.

- [ ] **Step 2: Domain**

- [ ] Vercel → Project → Settings → Domains → add `thissongfits.com` and `www.thissongfits.com` (redirect www → apex).
- [ ] Registrar DNS: add the records Vercel shows (`A` for the apex to Vercel's IP, `CNAME` for `www` to `cname.vercel-dns.com`). Wait for "Valid Configuration".
- [ ] `https://thissongfits.com` serves the app with a valid certificate.

- [ ] **Step 3: Auth and payment URLs**

- [ ] Supabase → Authentication → URL Configuration: Site URL `https://thissongfits.com`; Redirect URLs: `https://thissongfits.com/auth/callback` and `http://localhost:3000/auth/callback` only (no `*.vercel.app` wildcard — M3).
- [ ] Google Cloud Console → the OAuth client from Phase 1: Authorized JavaScript origins add `https://thissongfits.com`; the redirect URI remains `https://<project-ref>.supabase.co/auth/v1/callback`.
- [ ] Vercel env: `NEXT_PUBLIC_SITE_URL=https://thissongfits.com`; all Stripe LIVE values from Task 4.4 Step 8 (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`, `NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL`). Redeploy.
- [ ] Stripe live webhook endpoint → `https://thissongfits.com/api/stripe/webhook`; live Payment Link redirects to `https://thissongfits.com/subscribe/thanks`.

- [ ] **Step 4: Smoke test from a phone on cellular**

- [ ] Wi-Fi off. Open `https://thissongfits.com`. Tap "Continue with Google" (first tap), sign in, the upload form appears.
- [ ] Upload a 60–90 s iPhone MOV from the camera roll; progress bar moves; waiting state appears.
- [ ] Results within ~2 minutes: three real songs, sections inside the tracks, "Open in Spotify" works. (Previews only if `PREVIEWS_ENABLED`.)
- [ ] "Use this" collapses the others; the offer appears; `/admin` shows the submission `ready` with timing; `/admin/metrics` funnel has 1 creator at each stage reached.
- [ ] Second upload attempt as the same creator → `/subscribe`.

- [ ] **Step 5: README deploy section**

Append to `README.md`:

```markdown
## Deploy

Production runs on Vercel (Pro) from the `main` branch at https://thissongfits.com.
Env vars live in Vercel (Settings → Environment Variables); `.env.example` is the list.
The submit route and the admin run route export `maxDuration = 300`.
Supabase: Pro plan, Storage file limit 150 MB, Auth Site URL and redirect URLs set to the production domain.
Google OAuth origins include the production domain. Stripe webhook: `https://thissongfits.com/api/stripe/webhook`.
```

- [ ] **Step 6: Commit**

```bash
git add README.md src/shared/config.ts components/UploadForm.tsx
git commit -m "Document production deployment"
git push
```

(Only include `src/shared/config.ts` and `components/UploadForm.tsx` if Step 1's 50 MB fallback was taken.)

---

### Task 4.8: Launch-day runbook

**Files:**
- Create: `docs/RUNBOOK.md`

- [ ] **Step 1: Write the runbook**

`docs/RUNBOOK.md`:

```markdown
# Songfit launch runbook

## Watch (every hour on launch days)
- `/admin?status=failed` — any failed submission. Read the `error` text:
  - `analyze:` prefix → ffmpeg/Whisper/Claude analysis problem. Retry once. If it fails again, open the inspector and check the video plays; a corrupt or 0-byte upload is the usual cause.
  - `recommend:` prefix with "fewer than 3 verified" → the generator named songs Deezer can't find. Retry (the retry prompt carries exclusions and asks for better-known songs).
  - `budget exceeded` → pipeline hit the time budget. Retry; it resumes from the failed stage.
- A run that is lost: status stuck in `analyzing` or `recommending` for more than 6 minutes with no change. The claim allows stale takeover after `LIMITS.inFlightStaleMinutes`, so `/admin` → open → Retry simply works. If it happens more than once, check Vercel logs for the submit route being killed early (function duration or memory).
- `/admin` — median upload→ready creeping past 150 s means Claude or Deezer is slow; nothing to do unless runs fail.
- Anthropic console → Usage. Expect roughly $0.15–0.40 per submission with Sonnet on candidates/scoring/explain and Fable on analysis. A spike means a retry loop; look for one submission with many `pipeline_failed` events.
- Vercel → Logs, filter `error`. 504 on `/api/submissions` means the function duration limit; see Deploy in README.
- Stripe → Developers → Webhooks → the endpoint: any event with a non-2xx response. The handler returns 500 on purpose when activation fails so Stripe retries; if retries are exhausted, open the event and press Resend. Nothing is lost: an event is recorded only after its effects are committed.

## Retry a submission
`/admin` (failed rows are red) → Retry. It re-runs from the failed stage. Candidates and recommendations for that submission are replaced, never duplicated.

## Fix a bad recommendation by hand
Supabase Studio → Table editor:
1. `recommendations` → filter `submission_id` → edit `title`, `artist`, `start_seconds`, `end_seconds`, `explanation`, `artwork_url`, `spotify_url` directly. Rank stays 1–3. The creator's page shows the change on next load.
2. To swap in a different candidate: copy its row from `candidates` (same `submission_id`) into the recommendation row's fields; set `candidate_id` to that candidate's id.
3. To build a Spotify link by hand: `https://open.spotify.com/search/<Title>%20<Artist>`.
Note every manual change under "Manual fixes" below with the submission id. Do not invent event names.

## Cancel or refund a subscriber
Creators cancel themselves via "Manage or cancel" (Stripe Customer Portal). To do it for them: Stripe → Customers → the customer → subscription → Cancel. The `customer.subscription.deleted` webhook sets their row to `canceled`, which closes the paywall for them again. Refunds: Stripe → Payments → Refund.

## Disable previews / toggle launch flags
`src/shared/config.ts`: `PREVIEWS_ENABLED` (false at launch per the C8 ruling). Change, commit, push; Vercel redeploys in ~2 minutes.

## Overused songs
Edit `src/engine/scoring/config/overused.ts`: add `{ title, artist }` entries (normalised matching is case/punctuation-insensitive). Commit and push. Entries get the overuse penalty on `originality`.

## Reading the metrics page for the deck
`/admin/metrics`:
- Tile "Paying creators (active)" = creators with an active subscription right now (target 10). Cross-check Stripe → Customers.
- "Funnel → submission_created, creators" = distinct creators who submitted (target 100).
- "Funnel → recommendations_ready, submissions" = results delivered; "creators" = distinct creators who got a result.
- "recommendation_selected, submissions" ÷ "recommendations_viewed, submissions" = pick rate.
- "Median upload → ready" = time to result. "Median ready → selection" = decision time.
- "By category" = which niche picks most; use the select-rate column.
- "Returning creators" = came back for a second video.
- "All events" are raw row counts (repeat views count multiple times); use the funnel for the deck.

## Manual fixes
(append: date, submission id, what changed, why)
```

- [ ] **Step 2: Commit**

```bash
git add docs/RUNBOOK.md
git commit -m "Add launch runbook"
git push
```

---

### Phase 4 demo check

All on `https://thissongfits.com` from a phone, Stripe in test mode until Wednesday evening:

- [ ] `pnpm typecheck && pnpm test && pnpm build` pass on `main`; Vercel production deployment is green.
- [ ] Creator A (fresh Google account): sign in (first tap) → upload → waiting → 3 results → "Use this" on one → offer appears → "Get Songfit" → Stripe test checkout `4242 4242 4242 4242` → `/subscribe/thanks` shows "Activating…" then "You're in." → "Find my songs" → a second upload is accepted and produces results. Refresh the first results page: the pick is still marked.
- [ ] Creator B (another Google account): first upload works; second upload attempt redirects to `/subscribe` with "You've used your free Songfit."; `events` has a `paid_offer_viewed` row with B's `creator_id` and null `submission_id`.
- [ ] Creator A rejects all three on the second result: "Want 3 different directions?" and the offer appear; `events` has one `all_rejected` and one `more_like_this_requested` with A's `creator_id`.
- [ ] Resend A's `checkout.session.completed` from the Stripe dashboard: webhook replies `duplicate`; still one `paid` event; still one active subscription.
- [ ] `/admin/metrics`: `submission_created` creators = 2, `recommendations_ready` creators = 2, paying creators = 1, non-null medians, category rows with ready counts equal to the number of ready submissions (not inflated), returning creators = 1.
- [ ] `/admin` has no failed rows, or every failed row has been retried to `ready`.
