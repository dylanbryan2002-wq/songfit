## Phase 4 — Feedback, paywall, admin metrics, launch

**Demo when done:** on thissongfits.com from a phone: upload → results → "Use this" → offer → pay (Stripe test mode) → thanks → second upload allowed. A second creator who has not paid hits `/subscribe` on their second upload. `/admin/metrics` shows the funnel.

Assumes Phases 0–3 are merged: full pipeline, `app/results/[id]/page.tsx` rendering `RecommendationCard` with `onSelect(rank)` / `onReject(rank)` props, `logEvent` in `src/feedback/events.ts`, `canSubmit` in `src/billing/paywall.ts`, queries `insertEvent`, `getActiveSubscription`, `activateSubscription`, `listSubmissions`, `getSubmission`, `getCreator`, `requireAdmin`, admin queue and inspector pages.

---

### Task 4.1: Feedback actions, migration and API route

**Files:**
- Create: `supabase/migrations/0004_feedback.sql`
- Create: `src/feedback/actions.ts`
- Create: `app/api/submissions/[id]/feedback/route.ts`
- Modify: `src/db/queries/recommendations.ts` (add `markRecommendation`)
- Modify: `docs/DATA_MODEL.md` (recommendations table, new `stripe_events` table)
- Test: `tests/feedback/actions.test.ts`

**Interfaces:**
- Consumes: `logEvent({ name, creatorId, submissionId, metadata })` from `src/feedback/events.ts`; `getSubmission(id)` from `src/db/queries/submissions.ts` returning `{ id, creator_id, status, ... } | null`; `createServiceClient()` from `src/db/client.ts`; `getCreator()` from `src/auth/session.ts`.
- Produces:
  ```ts
  // src/db/queries/recommendations.ts
  export async function markRecommendation(submissionId: string, rank: 1 | 2 | 3, patch: { selected?: boolean; rejected?: boolean }): Promise<void>;
  // src/feedback/actions.ts
  export type FeedbackAction = "select" | "reject" | "all_rejected" | "offer_viewed" | "offer_clicked";
  export async function selectRecommendation(submissionId: string, rank: 1 | 2 | 3, creatorId: string): Promise<void>;
  export async function rejectRecommendation(submissionId: string, rank: 1 | 2 | 3, creatorId: string): Promise<void>;
  export async function allRejected(submissionId: string, creatorId: string): Promise<void>;
  export async function offerViewed(submissionId: string, creatorId: string): Promise<void>;
  export async function offerClicked(submissionId: string, creatorId: string): Promise<void>;
  ```
  Route: `POST /api/submissions/[id]/feedback` body `{ action: FeedbackAction; rank?: 1|2|3 }` → `204`, `400` bad body, `401` signed out, `403` not owner, `404` no submission.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0004_feedback.sql`:

```sql
-- Feedback flags on recommendations
alter table recommendations
  add column selected boolean not null default false,
  add column rejected boolean not null default false;

-- Stripe webhook idempotency
create table stripe_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);
alter table stripe_events enable row level security;
-- service role only: no policies.
```

- [ ] **Step 2: Apply it and regenerate types**

Run: `pnpm db:reset && pnpm db:types`
Expected: `Finished supabase db reset` and `src/db/types.ts` now contains `selected: boolean` under `recommendations` and a `stripe_events` table.

- [ ] **Step 3: Update docs/DATA_MODEL.md**

In the `## recommendations` table append two rows after `preview_url`:

```markdown
| selected        | boolean     | default false, set by "Use this"        |
| rejected        | boolean     | default false, set by "Not for me"      |
```

After the `## subscriptions` section add:

```markdown
## stripe_events
Idempotency log for the Stripe webhook. One row per processed Stripe event id.

| column     | type        | notes                      |
|------------|-------------|----------------------------|
| id         | text        | Stripe event id, primary key |
| type       | text        | Stripe event type          |
| created_at | timestamptz |                            |

RLS: service role only.
```

- [ ] **Step 4: Write the failing test**

`tests/feedback/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const markRecommendation = vi.fn();
const logEvent = vi.fn();
vi.mock("@/src/db/queries/recommendations", () => ({ markRecommendation }));
vi.mock("@/src/feedback/events", () => ({ logEvent }));

import { selectRecommendation, rejectRecommendation, allRejected, offerViewed, offerClicked } from "@/src/feedback/actions";

describe("feedback actions", () => {
  beforeEach(() => { markRecommendation.mockReset(); logEvent.mockReset(); });

  it("select marks the row and logs recommendation_selected with rank", async () => {
    await selectRecommendation("sub-1", 2, "cre-1");
    expect(markRecommendation).toHaveBeenCalledWith("sub-1", 2, { selected: true });
    expect(logEvent).toHaveBeenCalledWith({ name: "recommendation_selected", creatorId: "cre-1", submissionId: "sub-1", metadata: { rank: 2 } });
  });

  it("reject marks the row and logs recommendation_rejected with rank", async () => {
    await rejectRecommendation("sub-1", 3, "cre-1");
    expect(markRecommendation).toHaveBeenCalledWith("sub-1", 3, { rejected: true });
    expect(logEvent).toHaveBeenCalledWith({ name: "recommendation_rejected", creatorId: "cre-1", submissionId: "sub-1", metadata: { rank: 3 } });
  });

  it("allRejected logs all_rejected then more_like_this_requested", async () => {
    await allRejected("sub-1", "cre-1");
    expect(logEvent.mock.calls.map((c) => c[0].name)).toEqual(["all_rejected", "more_like_this_requested"]);
  });

  it("offer events log paid_offer_viewed / paid_offer_clicked", async () => {
    await offerViewed("sub-1", "cre-1");
    await offerClicked("sub-1", "cre-1");
    expect(logEvent.mock.calls.map((c) => c[0].name)).toEqual(["paid_offer_viewed", "paid_offer_clicked"]);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm vitest run tests/feedback/actions.test.ts`
Expected: FAIL — `Cannot find module '@/src/feedback/actions'`.

- [ ] **Step 6: Add the query**

Append to `src/db/queries/recommendations.ts`:

```ts
export async function markRecommendation(
  submissionId: string,
  rank: 1 | 2 | 3,
  patch: { selected?: boolean; rejected?: boolean },
): Promise<void> {
  const db = createServiceClient();
  const { error } = await db
    .from("recommendations")
    .update(patch)
    .eq("submission_id", submissionId)
    .eq("rank", rank);
  if (error) throw new Error(`markRecommendation: ${error.message}`);
}
```

(`createServiceClient` is already imported at the top of that file from `../client`.)

- [ ] **Step 7: Write the actions**

`src/feedback/actions.ts`:

```ts
import { markRecommendation } from "@/src/db/queries/recommendations";
import { logEvent } from "@/src/feedback/events";

export type FeedbackAction = "select" | "reject" | "all_rejected" | "offer_viewed" | "offer_clicked";
export type Rank = 1 | 2 | 3;

export async function selectRecommendation(submissionId: string, rank: Rank, creatorId: string): Promise<void> {
  await markRecommendation(submissionId, rank, { selected: true });
  await logEvent({ name: "recommendation_selected", creatorId, submissionId, metadata: { rank } });
}

export async function rejectRecommendation(submissionId: string, rank: Rank, creatorId: string): Promise<void> {
  await markRecommendation(submissionId, rank, { rejected: true });
  await logEvent({ name: "recommendation_rejected", creatorId, submissionId, metadata: { rank } });
}

export async function allRejected(submissionId: string, creatorId: string): Promise<void> {
  await logEvent({ name: "all_rejected", creatorId, submissionId });
  await logEvent({ name: "more_like_this_requested", creatorId, submissionId });
}

export async function offerViewed(submissionId: string, creatorId: string): Promise<void> {
  await logEvent({ name: "paid_offer_viewed", creatorId, submissionId });
}

export async function offerClicked(submissionId: string, creatorId: string): Promise<void> {
  await logEvent({ name: "paid_offer_clicked", creatorId, submissionId });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run tests/feedback/actions.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Write the route**

`app/api/submissions/[id]/feedback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import {
  selectRecommendation, rejectRecommendation, allRejected, offerViewed, offerClicked,
} from "@/src/feedback/actions";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select"), rank: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ action: z.literal("reject"), rank: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ action: z.literal("all_rejected") }),
  z.object({ action: z.literal("offer_viewed") }),
  z.object({ action: z.literal("offer_clicked") }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const submission = await getSubmission(id);
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.creator_id !== creator.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = parsed.data;
  switch (body.action) {
    case "select": await selectRecommendation(id, body.rank, creator.id); break;
    case "reject": await rejectRecommendation(id, body.rank, creator.id); break;
    case "all_rejected": await allRejected(id, creator.id); break;
    case "offer_viewed": await offerViewed(id, creator.id); break;
    case "offer_clicked": await offerClicked(id, creator.id); break;
  }
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 10: Typecheck and manual check**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass.

Run (with `pnpm dev` up and a signed-in browser session; copy the `sb-*` cookie value from devtools, or use the browser console):

```js
await fetch("/api/submissions/<a ready submission id>/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "select", rank: 1 }) }).then(r => r.status)
```
Expected: `204`, and in Supabase Studio the `recommendations` row with rank 1 has `selected = true` and `events` has a `recommendation_selected` row.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/0004_feedback.sql src/db/types.ts src/db/queries/recommendations.ts src/feedback/actions.ts app/api/submissions/[id]/feedback/route.ts tests/feedback/actions.test.ts docs/DATA_MODEL.md
git commit -m "Add feedback actions, flags and API route"
```

---

### Task 4.2: Results state reducer and client wiring

**Files:**
- Create: `src/feedback/resultsState.ts`
- Create: `components/ResultsClient.tsx`
- Modify: `app/results/[id]/page.tsx` (render `ResultsClient` instead of mapping cards directly)
- Test: `tests/feedback/resultsState.test.ts`

**Interfaces:**
- Consumes: `RecommendationCard` props `{ rec: FinalRecommendation; onSelect: (rank: 1|2|3) => void; onReject: (rank: 1|2|3) => void; collapsed?: boolean; chosen?: boolean }` (add `collapsed`/`chosen` props to the card in this task if Phase 3 did not include them: `collapsed` hides everything but title/artist, `chosen` shows a "Your pick" badge and hides the buttons). `Offer` from Task 4.3 (create a stub in this task's Step 7 if executing out of order).
- Produces:
  ```ts
  // src/feedback/resultsState.ts
  export type ResultsState = { chosen: 1 | 2 | 3 | null; rejected: Set<1 | 2 | 3>; showOffer: boolean; allRejected: boolean };
  export type ResultsAction = { type: "select"; rank: 1 | 2 | 3 } | { type: "reject"; rank: 1 | 2 | 3 };
  export const initialResultsState: ResultsState;
  export function nextResultsState(state: ResultsState, action: ResultsAction): ResultsState;
  ```

- [ ] **Step 1: Write the failing test**

`tests/feedback/resultsState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { initialResultsState, nextResultsState } from "@/src/feedback/resultsState";

describe("nextResultsState", () => {
  it("select sets chosen and shows the offer", () => {
    const s = nextResultsState(initialResultsState, { type: "select", rank: 2 });
    expect(s.chosen).toBe(2);
    expect(s.showOffer).toBe(true);
    expect(s.allRejected).toBe(false);
  });

  it("rejecting one does not show the offer", () => {
    const s = nextResultsState(initialResultsState, { type: "reject", rank: 1 });
    expect(s.rejected.has(1)).toBe(true);
    expect(s.showOffer).toBe(false);
  });

  it("rejecting all three sets allRejected and shows the offer", () => {
    let s = initialResultsState;
    s = nextResultsState(s, { type: "reject", rank: 1 });
    s = nextResultsState(s, { type: "reject", rank: 2 });
    s = nextResultsState(s, { type: "reject", rank: 3 });
    expect(s.allRejected).toBe(true);
    expect(s.showOffer).toBe(true);
  });

  it("select after a chosen pick is ignored", () => {
    let s = nextResultsState(initialResultsState, { type: "select", rank: 1 });
    s = nextResultsState(s, { type: "select", rank: 3 });
    expect(s.chosen).toBe(1);
  });

  it("rejecting the chosen pick is ignored", () => {
    let s = nextResultsState(initialResultsState, { type: "select", rank: 1 });
    s = nextResultsState(s, { type: "reject", rank: 1 });
    expect(s.rejected.size).toBe(0);
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
export type ResultsState = { chosen: Rank | null; rejected: Set<Rank>; showOffer: boolean; allRejected: boolean };
export type ResultsAction = { type: "select"; rank: Rank } | { type: "reject"; rank: Rank };

export const initialResultsState: ResultsState = { chosen: null, rejected: new Set(), showOffer: false, allRejected: false };

export function nextResultsState(state: ResultsState, action: ResultsAction): ResultsState {
  if (state.chosen !== null) return state; // once chosen, nothing changes
  if (action.type === "select") {
    return { ...state, chosen: action.rank, showOffer: true, allRejected: false };
  }
  const rejected = new Set(state.rejected);
  rejected.add(action.rank);
  const all = rejected.size === 3;
  return { ...state, rejected, allRejected: all, showOffer: state.showOffer || all };
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
import type { FinalRecommendation } from "@/src/shared/types";
import { initialResultsState, nextResultsState, type Rank } from "@/src/feedback/resultsState";
import { RecommendationCard } from "@/components/RecommendationCard";
import { Offer } from "@/components/Offer";

type Props = { submissionId: string; recs: FinalRecommendation[]; creatorEmail: string; creatorId: string };

async function post(submissionId: string, body: Record<string, unknown>) {
  await fetch(`/api/submissions/${submissionId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined); // feedback is best-effort for the UI
}

export function ResultsClient({ submissionId, recs, creatorEmail, creatorId }: Props) {
  const [state, dispatch] = useReducer(nextResultsState, initialResultsState);

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

In `app/results/[id]/page.tsx`, where Phase 3 rendered the three cards, replace that block with:

```tsx
<ResultsClient
  submissionId={submission.id}
  recs={recommendations}
  creatorEmail={creator.email}
  creatorId={creator.id}
/>
```

and add `import { ResultsClient } from "@/components/ResultsClient";`. The page already has `creator` from `getCreator()` and `recommendations` as `FinalRecommendation[]`.

If `RecommendationCard` lacks `chosen`/`collapsed`, add to its props and render:

```tsx
// in RecommendationCard props type
chosen?: boolean;
collapsed?: boolean;
// in the JSX, at the top of the card
{chosen && <span className="rounded-full bg-black px-3 py-1 text-xs text-white">Your pick</span>}
// wrap the explanation, preview, Spotify link and buttons in:
{!collapsed && ( ...existing body... )}
// hide buttons when chosen:
{!chosen && !collapsed && ( ...Use this / Not for me buttons... )}
```

- [ ] **Step 7: Temporary Offer stub (only if Task 4.3 is not done yet)**

`components/Offer.tsx`:

```tsx
"use client";
export function Offer(_: { submissionId: string; creatorEmail: string; creatorId: string }) {
  return <div className="rounded-2xl border p-6 text-center">Offer goes here.</div>;
}
```

Task 4.3 replaces this file.

- [ ] **Step 8: Typecheck, run, verify in the browser**

Run: `pnpm typecheck && pnpm test`
Expected: pass.

Run `pnpm dev`, open a ready `/results/<id>` on a 390 px wide viewport. Tap "Use this" on #2: #1 and #3 collapse to title/artist, #2 shows "Your pick", the offer block appears. Reload, tap "Not for me" on all three: the "Want 3 different directions?" line and the offer appear. In Supabase Studio `events` contains `recommendation_selected`, `recommendation_rejected` ×3, `all_rejected`, `more_like_this_requested`.

- [ ] **Step 9: Commit**

```bash
git add src/feedback/resultsState.ts components/ResultsClient.tsx components/RecommendationCard.tsx components/Offer.tsx app/results/[id]/page.tsx tests/feedback/resultsState.test.ts
git commit -m "Wire results feedback with a state reducer and client wrapper"
```

---

### Task 4.3: Offer component and paywall pages

**Files:**
- Create (replace stub): `components/Offer.tsx`
- Create: `src/billing/paymentLink.ts`
- Create: `app/subscribe/page.tsx`
- Create: `app/subscribe/thanks/page.tsx`
- Modify: `.env.example` (add `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`)
- Test: `tests/billing/paymentLink.test.ts`

**Interfaces:**
- Consumes: `getCreator()`; `redirect` from `next/navigation`; `UploadForm` already redirects to `/subscribe` when `POST /api/upload-url` returns 402 (Phase 1).
- Produces:
  ```ts
  // src/billing/paymentLink.ts
  export function buildPaymentLink(base: string, creatorEmail: string, creatorId: string): string;
  // components/Offer.tsx
  export function Offer(props: { submissionId: string | null; creatorEmail: string; creatorId: string; headline?: string }): JSX.Element;
  ```
  Env: `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL` (public: it is a public Stripe URL; being `NEXT_PUBLIC_` lets the client component build the link).

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

- [ ] **Step 5: Write the Offer component**

`components/Offer.tsx` (replaces the Task 4.2 stub):

```tsx
"use client";
import { useEffect, useRef } from "react";
import { buildPaymentLink } from "@/src/billing/paymentLink";

type Props = { submissionId: string | null; creatorEmail: string; creatorId: string; headline?: string };

function track(submissionId: string | null, action: "offer_viewed" | "offer_clicked") {
  if (!submissionId) return;
  void fetch(`/api/submissions/${submissionId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
    keepalive: true,
  }).catch(() => undefined);
}

export function Offer({ submissionId, creatorEmail, creatorId, headline = "Want Songfit for your next posts?" }: Props) {
  const base = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL ?? "";
  const href = base ? buildPaymentLink(base, creatorEmail, creatorId) : "#";
  const viewed = useRef(false);

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track(submissionId, "offer_viewed");
  }, [submissionId]);

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
      <h2 className="text-xl font-semibold tracking-tight">{headline}</h2>
      <p className="mt-2 text-neutral-600">$9.99/month, cancel anytime.</p>
      <a
        href={href}
        onClick={() => track(submissionId, "offer_clicked")}
        className="mt-5 inline-block w-full rounded-full bg-black px-6 py-3 text-base font-medium text-white"
      >
        Get Songfit
      </a>
    </section>
  );
}
```

- [ ] **Step 6: Write the paywall pages**

`app/subscribe/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCreator } from "@/src/auth/session";
import { Offer } from "@/components/Offer";
import { Logo } from "@/components/Logo";

export default async function SubscribePage() {
  const creator = await getCreator();
  if (!creator) redirect("/?signin=1");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <p className="text-center text-neutral-700">You&apos;ve used your free Songfit. Subscribe to keep going.</p>
      <Offer submissionId={null} creatorEmail={creator.email} creatorId={creator.id} headline="Songfit for every post" />
    </main>
  );
}
```

`app/subscribe/thanks/page.tsx`:

```tsx
import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function ThanksPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <Logo />
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re in.</h1>
      <p className="text-neutral-700">Upload your next video.</p>
      <Link href="/" className="rounded-full bg-black px-6 py-3 font-medium text-white">Find my songs</Link>
    </main>
  );
}
```

`?signin=1` on `/`: `UploadForm` (Phase 1) opens Google sign-in when the button is tapped; if the Phase 1 form does not already read this param, add in `UploadForm`:

```tsx
useEffect(() => {
  if (new URLSearchParams(window.location.search).get("signin") === "1") void signInWithGoogle();
}, []);
```

- [ ] **Step 7: Env example**

Append to `.env.example`:

```
# Stripe
NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL=https://buy.stripe.com/test_replace_me
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
```

- [ ] **Step 8: Typecheck and verify**

Run: `pnpm typecheck && pnpm test`
Expected: pass.

Run `pnpm dev`; sign in as a creator who already has one ready submission; tap "Find my songs" with a new file. Expected: redirected to `/subscribe`, offer shows, `events` gets `paid_offer_viewed` only when a `submissionId` is present (on `/subscribe` it is null, so none; on results it logs). The "Get Songfit" link opens the Stripe test link with your email prefilled.

- [ ] **Step 9: Commit**

```bash
git add components/Offer.tsx src/billing/paymentLink.ts app/subscribe/page.tsx app/subscribe/thanks/page.tsx .env.example tests/billing/paymentLink.test.ts components/UploadForm.tsx
git commit -m "Add offer component and subscribe pages"
```

---

### Task 4.4: Stripe webhook

**Files:**
- Create: `src/billing/stripe.ts`
- Create: `app/api/stripe/webhook/route.ts`
- Modify: `src/db/queries/subscriptions.ts` (add `setSubscriptionStatusByStripeId`), `src/db/queries/creators.ts` (add `getCreatorByEmail`), create `src/db/queries/stripeEvents.ts`
- Test: `tests/billing/stripe.test.ts`

**Interfaces:**
- Consumes: `activateSubscription({ creatorId, stripeCustomerId, stripeSubscriptionId })` (Phase 1/3 query: upserts a `subscriptions` row with `status = 'active'`, `started_at = now()`); `logEvent`.
- Produces:
  ```ts
  // src/db/queries/stripeEvents.ts
  export async function claimStripeEvent(id: string, type: string): Promise<boolean>; // true if newly inserted, false if already processed
  // src/db/queries/subscriptions.ts
  export async function setSubscriptionStatusByStripeId(stripeSubscriptionId: string, status: "active" | "canceled" | "past_due"): Promise<void>;
  // src/db/queries/creators.ts
  export async function getCreatorByEmail(email: string): Promise<{ id: string; email: string } | null>;
  // src/billing/stripe.ts
  export function verifyWebhook(rawBody: string, signature: string): Stripe.Event; // throws on bad signature
  export type StripeDeps = { claimStripeEvent; activateSubscription; setSubscriptionStatusByStripeId; getCreatorByEmail; logEvent };
  export async function handleStripeEvent(event: Stripe.Event, deps?: Partial<StripeDeps>): Promise<"processed" | "duplicate" | "ignored">;
  ```

- [ ] **Step 1: Install stripe**

Run: `pnpm add stripe`
Expected: `stripe` added to dependencies in `package.json`.

- [ ] **Step 2: Write the failing test**

`tests/billing/stripe.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { handleStripeEvent } from "@/src/billing/stripe";

function deps(over: Partial<Record<string, unknown>> = {}) {
  return {
    claimStripeEvent: vi.fn(async () => true),
    activateSubscription: vi.fn(async () => undefined),
    setSubscriptionStatusByStripeId: vi.fn(async () => undefined),
    getCreatorByEmail: vi.fn(async () => ({ id: "cre-by-email", email: "a@x.com" })),
    logEvent: vi.fn(async () => undefined),
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
        customer_details: { email: "a@x.com" },
        ...over,
      } as Stripe.Checkout.Session,
    },
  } as unknown as Stripe.Event;
}

describe("handleStripeEvent", () => {
  it("activates the subscription and logs paid on checkout.session.completed", async () => {
    const d = deps();
    const r = await handleStripeEvent(checkoutEvent(), d);
    expect(r).toBe("processed");
    expect(d.activateSubscription).toHaveBeenCalledWith({ creatorId: "cre-1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" });
    expect(d.logEvent).toHaveBeenCalledWith({ name: "paid", creatorId: "cre-1", metadata: { stripeSubscriptionId: "sub_1" } });
  });

  it("falls back to email lookup when client_reference_id is missing", async () => {
    const d = deps();
    await handleStripeEvent(checkoutEvent({ client_reference_id: null }), d);
    expect(d.getCreatorByEmail).toHaveBeenCalledWith("a@x.com");
    expect(d.activateSubscription).toHaveBeenCalledWith(expect.objectContaining({ creatorId: "cre-by-email" }));
  });

  it("returns duplicate and does nothing when the event id was already claimed", async () => {
    const d = deps({ claimStripeEvent: vi.fn(async () => false) });
    const r = await handleStripeEvent(checkoutEvent(), d);
    expect(r).toBe("duplicate");
    expect(d.activateSubscription).not.toHaveBeenCalled();
  });

  it("marks canceled on customer.subscription.deleted", async () => {
    const d = deps();
    const ev = { id: "evt_2", type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled" } } } as unknown as Stripe.Event;
    const r = await handleStripeEvent(ev, d);
    expect(r).toBe("processed");
    expect(d.setSubscriptionStatusByStripeId).toHaveBeenCalledWith("sub_1", "canceled");
  });

  it("marks past_due on customer.subscription.updated with status past_due", async () => {
    const d = deps();
    const ev = { id: "evt_3", type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "past_due" } } } as unknown as Stripe.Event;
    await handleStripeEvent(ev, d);
    expect(d.setSubscriptionStatusByStripeId).toHaveBeenCalledWith("sub_1", "past_due");
  });

  it("ignores unknown event types", async () => {
    const d = deps();
    const ev = { id: "evt_4", type: "invoice.paid", data: { object: {} } } as unknown as Stripe.Event;
    expect(await handleStripeEvent(ev, d)).toBe("ignored");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/billing/stripe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Add the queries**

`src/db/queries/stripeEvents.ts`:

```ts
import { createServiceClient } from "../client";

/** Insert the event id; returns false if it was already there (duplicate delivery). */
export async function claimStripeEvent(id: string, type: string): Promise<boolean> {
  const db = createServiceClient();
  const { error } = await db.from("stripe_events").insert({ id, type });
  if (!error) return true;
  if (error.code === "23505") return false; // unique_violation
  throw new Error(`claimStripeEvent: ${error.message}`);
}
```

Append to `src/db/queries/subscriptions.ts`:

```ts
export async function setSubscriptionStatusByStripeId(
  stripeSubscriptionId: string,
  status: "active" | "canceled" | "past_due",
): Promise<void> {
  const db = createServiceClient();
  const { error } = await db.from("subscriptions").update({ status }).eq("stripe_subscription_id", stripeSubscriptionId);
  if (error) throw new Error(`setSubscriptionStatusByStripeId: ${error.message}`);
}
```

Append to `src/db/queries/creators.ts`:

```ts
export async function getCreatorByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const db = createServiceClient();
  const { data, error } = await db.from("creators").select("id,email").ilike("email", email).maybeSingle();
  if (error) throw new Error(`getCreatorByEmail: ${error.message}`);
  return data;
}
```

- [ ] **Step 5: Write the Stripe module**

`src/billing/stripe.ts`:

```ts
import Stripe from "stripe";
import { env } from "@/src/shared/config";
import { logger } from "@/src/shared/logger";
import { claimStripeEvent as claimStripeEventDb } from "@/src/db/queries/stripeEvents";
import { activateSubscription as activateSubscriptionDb, setSubscriptionStatusByStripeId as setStatusDb } from "@/src/db/queries/subscriptions";
import { getCreatorByEmail as getCreatorByEmailDb } from "@/src/db/queries/creators";
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
  claimStripeEvent: typeof claimStripeEventDb;
  activateSubscription: typeof activateSubscriptionDb;
  setSubscriptionStatusByStripeId: typeof setStatusDb;
  getCreatorByEmail: typeof getCreatorByEmailDb;
  logEvent: typeof logEventDb;
};

const defaultDeps: StripeDeps = {
  claimStripeEvent: claimStripeEventDb,
  activateSubscription: activateSubscriptionDb,
  setSubscriptionStatusByStripeId: setStatusDb,
  getCreatorByEmail: getCreatorByEmailDb,
  logEvent: logEventDb,
};

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

export async function handleStripeEvent(
  event: Stripe.Event,
  overrides: Partial<StripeDeps> = {},
): Promise<"processed" | "duplicate" | "ignored"> {
  const deps = { ...defaultDeps, ...overrides };

  switch (event.type) {
    case "checkout.session.completed": {
      if (!(await deps.claimStripeEvent(event.id, event.type))) return "duplicate";
      const s = event.data.object as Stripe.Checkout.Session;
      let creatorId = s.client_reference_id ?? null;
      if (!creatorId) {
        const email = s.customer_details?.email ?? null;
        const creator = email ? await deps.getCreatorByEmail(email) : null;
        creatorId = creator?.id ?? null;
      }
      if (!creatorId) {
        logger.warn("stripe: checkout without resolvable creator", { sessionId: s.id });
        return "ignored";
      }
      const stripeCustomerId = idOf(s.customer) ?? "";
      const stripeSubscriptionId = idOf(s.subscription) ?? "";
      await deps.activateSubscription({ creatorId, stripeCustomerId, stripeSubscriptionId });
      await deps.logEvent({ name: "paid", creatorId, metadata: { stripeSubscriptionId } });
      return "processed";
    }
    case "customer.subscription.deleted":
    case "customer.subscription.updated": {
      if (!(await deps.claimStripeEvent(event.id, event.type))) return "duplicate";
      const sub = event.data.object as Stripe.Subscription;
      const status: "active" | "canceled" | "past_due" =
        event.type === "customer.subscription.deleted" ? "canceled"
        : sub.status === "active" || sub.status === "trialing" ? "active"
        : sub.status === "past_due" ? "past_due"
        : "canceled";
      await deps.setSubscriptionStatusByStripeId(sub.id, status);
      return "processed";
    }
    default:
      logger.info("stripe: ignored event", { type: event.type });
      return "ignored";
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/billing/stripe.test.ts`
Expected: PASS, 6 tests.

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
    logger.warn("stripe: bad signature", { message: (e as Error).message });
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    // Return 200 so Stripe does not retry forever; the error is logged for manual follow-up.
    logger.error("stripe: handler failed", { id: event.id, type: event.type, message: (e as Error).message });
    return NextResponse.json({ received: true, result: "error" });
  }
}
```

- [ ] **Step 8: Dylan's Stripe setup (do once, test mode first)**

- [ ] In Stripe Dashboard (test mode): Product catalog → Add product → name `Songfit`, recurring, `$9.99` monthly. Save.
- [ ] Payment Links → New → pick the Songfit price. Options: "Collect customers' email" on (default). After payment → "Don't show confirmation page" → redirect to `https://thissongfits.com/subscribe/thanks`. Create. Copy the link into `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`.
- [ ] Developers → API keys → copy the Secret key into `STRIPE_SECRET_KEY`.
- [ ] Developers → Webhooks → Add endpoint → `https://thissongfits.com/api/stripe/webhook` → events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` (in Vercel). For local use the CLI secret from the next step.
- [ ] Repeat all of the above in live mode on Wednesday evening, with live keys in Vercel.

- [ ] **Step 9: Local webhook test**

Install the Stripe CLI (`brew install stripe/stripe-cli/stripe` once Homebrew is available, or download from stripe.com/docs/stripe-cli) and run:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the printed `whsec_...` into `.env.local` as `STRIPE_WEBHOOK_SECRET`, restart `pnpm dev`, then in another terminal:

```bash
stripe trigger checkout.session.completed
```

Expected: `pnpm dev` logs `stripe: checkout without resolvable creator` (the trigger has no `client_reference_id` and a fake email) and the response is `200 {"received":true,"result":"ignored"}`. Then do a real test checkout: open the Payment Link from `/subscribe` while signed in, pay with card `4242 4242 4242 4242`, any future date, any CVC. Expected: redirect to `/subscribe/thanks`; `subscriptions` row with `status = active` for your creator; `events` row `paid`; the upload screen now accepts a second video.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml src/billing/stripe.ts app/api/stripe/webhook/route.ts src/db/queries/stripeEvents.ts src/db/queries/subscriptions.ts src/db/queries/creators.ts tests/billing/stripe.test.ts
git commit -m "Add Stripe webhook with idempotent subscription activation"
```

---

### Task 4.5: Metrics SQL function and admin metrics page

**Files:**
- Create: `supabase/migrations/0005_metrics.sql`
- Create: `src/db/queries/metrics.ts`
- Create: `src/shared/stats.ts`
- Create: `app/admin/metrics/page.tsx`
- Modify: `app/admin/layout.tsx` (add a "Metrics" nav link)
- Test: `tests/shared/stats.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()`; `createServiceClient()`.
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
    returningCreators: number;
  };
  export async function getMetrics(): Promise<Metrics>;
  ```
  SQL function `metrics_summary()` returning one jsonb; `updated_at` column + trigger on `submissions` (also used by Task 4.7).

- [ ] **Step 1: Write the failing test**

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

`supabase/migrations/0005_metrics.sql`:

```sql
-- updated_at on submissions (used by the double-run guard and timing)
alter table submissions add column updated_at timestamptz not null default now();

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger submissions_set_updated_at
  before update on submissions
  for each row execute function set_updated_at();

-- One-shot metrics summary. Service role only.
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
by_category as (
  select coalesce(s.content_category, 'unknown') as category,
    count(*) filter (where s.status = 'ready')::int as ready,
    count(distinct e.submission_id) filter (where e.name = 'recommendation_selected')::int as selected
  from submissions s left join events e on e.submission_id = s.id
  group by 1
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
  'returningCreators', (select n from returning_creators)
);
$$;

revoke all on function metrics_summary() from public, anon, authenticated;
```

Run: `pnpm db:reset && pnpm db:types`
Expected: reset finishes; `src/db/types.ts` gains `updated_at` on `submissions` and a `metrics_summary` entry under `Functions`.

- [ ] **Step 6: Write the query**

`src/db/queries/metrics.ts`:

```ts
import { z } from "zod";
import { createServiceClient } from "../client";
import { median } from "@/src/shared/stats";

const Raw = z.object({
  eventCounts: z.array(z.object({ name: z.string(), count: z.number() })),
  funnel: z.array(z.object({ stage: z.string(), submissions: z.number(), creators: z.number() })),
  uploadToReadySeconds: z.array(z.number()),
  readyToSelectionSeconds: z.array(z.number()),
  byCategory: z.array(z.object({ category: z.string(), ready: z.number(), selected: z.number() })),
  returningCreators: z.number(),
});

export type Metrics = {
  eventCounts: { name: string; count: number }[];
  funnel: { stage: string; submissions: number; creators: number }[];
  medianUploadToReadySeconds: number | null;
  medianReadyToSelectionSeconds: number | null;
  byCategory: { category: string; ready: number; selected: number }[];
  returningCreators: number;
};

export async function getMetrics(): Promise<Metrics> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("metrics_summary");
  if (error) throw new Error(`metrics_summary: ${error.message}`);
  const raw = Raw.parse(data);
  return {
    eventCounts: raw.eventCounts,
    funnel: raw.funnel,
    medianUploadToReadySeconds: median(raw.uploadToReadySeconds),
    medianReadyToSelectionSeconds: median(raw.readyToSelectionSeconds),
    byCategory: raw.byCategory,
    returningCreators: raw.returningCreators,
  };
}
```

- [ ] **Step 7: Write the page**

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

      <section>
        <h2 className="mb-2 font-medium">Funnel</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th>Stage</th><th>Submissions</th><th>Creators</th></tr></thead>
          <tbody>
            {m.funnel.map((f) => (
              <tr key={f.stage} className="border-t"><td>{f.stage}</td><td>{f.submissions}</td><td>{f.creators}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Median upload → ready</div><div className="text-xl">{secs(m.medianUploadToReadySeconds)}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Median ready → selection</div><div className="text-xl">{secs(m.medianReadyToSelectionSeconds)}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Returning creators (≥2 uploads)</div><div className="text-xl">{m.returningCreators}</div></div>
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
        <h2 className="mb-2 font-medium">All events</h2>
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

- [ ] **Step 8: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: pass.

Open `/admin/metrics` signed in as the admin. Expected: funnel rows in order `submission_created … paid`, medians shown in seconds, a category table, and an event count table. Signed in as a non-admin: redirected away (existing `requireAdmin` behaviour).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0005_metrics.sql src/db/types.ts src/db/queries/metrics.ts src/shared/stats.ts app/admin/metrics/page.tsx app/admin/layout.tsx tests/shared/stats.test.ts
git commit -m "Add metrics summary function and admin metrics page"
```

---

### Task 4.6: Admin queue polish

**Files:**
- Modify: `app/admin/page.tsx`
- Modify: `src/db/queries/submissions.ts` (`listSubmissions` accepts an optional status filter)

**Interfaces:**
- Consumes: existing `listSubmissions()` returning rows with `id, creator_id, status, content_category, created_at, recommended_at, error` plus the Phase 3 Retry server action.
- Produces: `listSubmissions(filter?: { status?: SubmissionStatus }): Promise<SubmissionRow[]>`; the page reads `?status=` from search params.

- [ ] **Step 1: Extend the query**

In `src/db/queries/submissions.ts` change `listSubmissions` to:

```ts
export async function listSubmissions(filter: { status?: SubmissionStatus } = {}) {
  const db = createServiceClient();
  let q = db
    .from("submissions")
    .select("id,creator_id,status,content_category,created_at,recommended_at,error,creators(email)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter.status) q = q.eq("status", filter.status);
  const { data, error } = await q;
  if (error) throw new Error(`listSubmissions: ${error.message}`);
  return data;
}
```

(`SubmissionStatus` imported from `@/src/shared/types`.)

- [ ] **Step 2: Update the page**

`app/admin/page.tsx`:

```tsx
import Link from "next/link";
import { requireAdmin } from "@/src/auth/session";
import { listSubmissions } from "@/src/db/queries/submissions";
import { SubmissionStatus } from "@/src/shared/types";
import { retrySubmission } from "./submissions/[id]/actions"; // Phase 2 server action, takes FormData with `id`

export const dynamic = "force-dynamic";

const STATUSES = SubmissionStatus.options;

export default async function AdminQueue({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const { status } = await searchParams;
  const parsed = SubmissionStatus.safeParse(status);
  const rows = await listSubmissions(parsed.success ? { status: parsed.data } : {});

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Submissions</h1>
      <nav className="my-3 flex gap-3 text-sm">
        <Link href="/admin" className={!parsed.success ? "font-semibold underline" : "underline"}>all</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin?status=${s}`} className={parsed.success && parsed.data === s ? "font-semibold underline" : "underline"}>{s}</Link>
        ))}
      </nav>
      <table className="w-full text-sm">
        <thead><tr className="text-left"><th>Created</th><th>Creator</th><th>Status</th><th>Category</th><th>Upload → ready</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const secs = r.recommended_at ? Math.round((new Date(r.recommended_at).getTime() - new Date(r.created_at).getTime()) / 1000) : null;
            const failed = r.status === "failed";
            return (
              <tr key={r.id} className={`border-t ${failed ? "bg-red-50" : ""}`}>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>{(r.creators as { email: string } | null)?.email ?? r.creator_id}</td>
                <td>{r.status}{failed && r.error ? <div className="text-xs text-red-700">{r.error}</div> : null}</td>
                <td>{r.content_category ?? "—"}</td>
                <td>{secs === null ? "—" : `${secs} s`}</td>
                <td className="flex gap-2">
                  <Link href={`/admin/submissions/${r.id}`} className="underline">open</Link>
                  {failed && (
                    <form action={retrySubmission}><input type="hidden" name="id" value={r.id} /><button className="underline">retry</button></form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck`
Expected: pass.
Open `/admin?status=failed`: only failed rows, red background, error text and a retry button. `/admin?status=ready` shows the upload→ready seconds.

- [ ] **Step 4: Commit**

```bash
git add app/admin/page.tsx src/db/queries/submissions.ts
git commit -m "Add status filter, timing column and failed highlighting to admin queue"
```

---

### Task 4.7: Hardening for launch

**Files:**
- Modify: `app/api/submissions/[id]/run/route.ts` (double-run guard)
- Modify: `app/api/upload-url/route.ts` (rate limit)
- Modify: `src/db/queries/submissions.ts` (`countRecentSubmissions`)
- Modify: `next.config.ts` (remote images)
- Modify: `app/layout.tsx` (viewport, theme-color)
- Create: `app/robots.ts`, `app/error.tsx`, `app/results/[id]/not-found.tsx`
- Test: `tests/pipeline/runGuard.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/pipeline/runGuard.ts
  export function shouldBlockRun(submission: { status: SubmissionStatus; updated_at: string }, now?: Date): boolean;
  // src/db/queries/submissions.ts
  export async function countRecentSubmissions(creatorId: string, withinMs: number): Promise<number>;
  ```

- [ ] **Step 1: Write the failing test**

`tests/pipeline/runGuard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldBlockRun } from "@/src/pipeline/runGuard";

const now = new Date("2026-10-08T10:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

describe("shouldBlockRun", () => {
  it("blocks when analyzing and updated 2 minutes ago", () => {
    expect(shouldBlockRun({ status: "analyzing", updated_at: ago(2) }, now)).toBe(true);
  });
  it("blocks when recommending and updated 5 minutes ago", () => {
    expect(shouldBlockRun({ status: "recommending", updated_at: ago(5) }, now)).toBe(true);
  });
  it("allows when recommending but stale for 7 minutes", () => {
    expect(shouldBlockRun({ status: "recommending", updated_at: ago(7) }, now)).toBe(false);
  });
  it("allows uploaded, failed and ready", () => {
    expect(shouldBlockRun({ status: "uploaded", updated_at: ago(0) }, now)).toBe(false);
    expect(shouldBlockRun({ status: "failed", updated_at: ago(0) }, now)).toBe(false);
    expect(shouldBlockRun({ status: "ready", updated_at: ago(0) }, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/pipeline/runGuard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the guard**

`src/pipeline/runGuard.ts`:

```ts
import type { SubmissionStatus } from "@/src/shared/types";

const IN_FLIGHT: SubmissionStatus[] = ["analyzing", "recommending"];
const STALE_MS = 6 * 60_000;

export function shouldBlockRun(
  submission: { status: SubmissionStatus; updated_at: string },
  now: Date = new Date(),
): boolean {
  if (!IN_FLIGHT.includes(submission.status)) return false;
  return now.getTime() - new Date(submission.updated_at).getTime() < STALE_MS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/pipeline/runGuard.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Apply the guard in the run route**

In `app/api/submissions/[id]/run/route.ts`, after the existing auth/ownership checks and `const submission = await getSubmission(id)`, add before calling `runSubmission`:

```ts
import { shouldBlockRun } from "@/src/pipeline/runGuard";
// ...
if (shouldBlockRun(submission)) {
  return NextResponse.json({ error: "already_running" }, { status: 409 });
}
```

`getSubmission` must select `updated_at`; if its `select` lists columns explicitly, add `updated_at` to it.

- [ ] **Step 6: Rate limit upload URLs**

Append to `src/db/queries/submissions.ts`:

```ts
export async function countRecentSubmissions(creatorId: string, withinMs: number): Promise<number> {
  const db = createServiceClient();
  const since = new Date(Date.now() - withinMs).toISOString();
  const { count, error } = await db
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .gte("created_at", since);
  if (error) throw new Error(`countRecentSubmissions: ${error.message}`);
  return count ?? 0;
}
```

In `app/api/upload-url/route.ts`, after the creator is resolved and before the `canSubmit` check, add:

```ts
import { countRecentSubmissions } from "@/src/db/queries/submissions";
// ...
if ((await countRecentSubmissions(creator.id, 60_000)) >= 5) {
  return NextResponse.json({ error: "rate_limited" }, { status: 429 });
}
```

- [ ] **Step 7: Config and chrome**

`next.config.ts` — ensure it contains:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

`app/layout.tsx` — add the exports (keep the existing `metadata` title/description):

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

`app/error.tsx`:

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

In `app/results/[id]/page.tsx`, where the submission is loaded, call `notFound()` from `next/navigation` when it is null or belongs to another creator (if Phase 3 returned a plain message instead).

- [ ] **Step 8: Verify**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all pass; build completes with no image-host warnings.

Manual: hit `POST /api/submissions/<in-flight id>/run` twice quickly → second returns 409. Open `/results/not-a-real-id` → not-found page. `curl -s localhost:3000/robots.txt` shows `Disallow: /admin`.

- [ ] **Step 9: Commit**

```bash
git add src/pipeline/runGuard.ts app/api/submissions/[id]/run/route.ts app/api/upload-url/route.ts src/db/queries/submissions.ts next.config.ts app/layout.tsx app/robots.ts app/error.tsx app/results/[id]/not-found.tsx app/results/[id]/page.tsx tests/pipeline/runGuard.test.ts
git commit -m "Harden pipeline run, uploads and error pages for launch"
```

---

### Task 4.8: Deploy to Vercel and thissongfits.com

**Files:**
- Modify: `README.md` (Deploy section)
- No code beyond the README; everything else is dashboard work.

- [ ] **Step 1: Push the repo to GitHub**

```bash
gh repo create songfit --private --source=. --push
```
Expected: repo URL printed; `git push` succeeds.

- [ ] **Step 2: Create the Vercel project**

- [ ] vercel.com → Add New → Project → import the `songfit` GitHub repo. Framework preset: Next.js (auto). Root directory: `/`. Build command default (`next build`), install command `pnpm install`.
- [ ] Environment variables (Production and Preview), copied from `.env.example` with real values:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_EMAILS`, `NEXT_PUBLIC_SITE_URL=https://thissongfits.com`, and `INTERNAL_TOKEN` generated with:
  ```bash
  openssl rand -hex 32
  ```
- [ ] Deploy. Expected: build green, `https://songfit-<hash>.vercel.app` loads the upload screen.

- [ ] **Step 3: Function duration**

`app/api/submissions/[id]/run/route.ts` exports `export const maxDuration = 300;` (Phase 3). Vercel honours up to 300 s on Hobby only with Fluid Compute enabled (Project → Settings → Functions → Fluid Compute → on), and on Pro by default. Check the plan in the Vercel dashboard; if the run route 504s after 60 s in the smoke test, enable Fluid Compute or upgrade to Pro before Thursday.

- [ ] **Step 4: Domain**

- [ ] Vercel → Project → Settings → Domains → add `thissongfits.com` and `www.thissongfits.com` (redirect www → apex).
- [ ] At the registrar's DNS: add the records Vercel shows (an `A` record for the apex to Vercel's IP and a `CNAME` for `www` to `cname.vercel-dns.com`). Wait for Vercel to show "Valid Configuration".
- [ ] Expected: `https://thissongfits.com` serves the app with a valid certificate.

- [ ] **Step 5: Auth URLs**

- [ ] Supabase → Authentication → URL Configuration: Site URL `https://thissongfits.com`; Redirect URLs add `https://thissongfits.com/auth/callback` and `https://*.vercel.app/auth/callback`.
- [ ] Google Cloud Console → the OAuth client from Phase 1: Authorized JavaScript origins add `https://thissongfits.com`; the authorized redirect URI stays the Supabase callback (`https://<project>.supabase.co/auth/v1/callback`).
- [ ] Stripe: ensure the live webhook endpoint from Task 4.4 points at `https://thissongfits.com/api/stripe/webhook`, and the live Payment Link redirects to `https://thissongfits.com/subscribe/thanks`.

- [ ] **Step 6: Smoke test from a phone on cellular**

- [ ] Open `https://thissongfits.com` on a phone, Wi-Fi off.
- [ ] Sign in with Google, upload a 30–60 s Reel from the camera roll, see the waiting state.
- [ ] Results appear within ~2 minutes with artwork and playable previews.
- [ ] "Use this" collapses the others and shows the offer.
- [ ] Admin: `/admin` shows the submission as `ready` with timing; `/admin/metrics` shows the funnel.

- [ ] **Step 7: README deploy section**

Append to `README.md`:

```markdown
## Deploy

Production runs on Vercel from the `main` branch at https://thissongfits.com.
Env vars live in Vercel (Settings → Environment Variables); `.env.example` is the list.
The pipeline route needs 300 s functions: Fluid Compute on Hobby, or Pro.
Supabase Auth Site URL and Google OAuth origins must include the production domain.
Stripe webhook: `https://thissongfits.com/api/stripe/webhook`.
```

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "Document deployment"
git push
```

---

### Task 4.9: Launch-day runbook

**Files:**
- Create: `docs/RUNBOOK.md`

- [ ] **Step 1: Write the runbook**

`docs/RUNBOOK.md`:

```markdown
# Songfit launch runbook

## Watch (every hour on launch days)
- `/admin?status=failed` — any failed submission. Read the `error` text:
  - `analyze:` prefix → ffmpeg/Whisper/Claude analysis problem. Retry once. If it fails again, open the inspector and check the video plays; a corrupt or 0-byte upload is the usual cause.
  - `recommend:` prefix with "fewer than 3 verified" → the generator named songs Deezer can't find. Retry (the retry prompt tells the model the last list was unverifiable).
  - `budget exceeded` → pipeline hit 280 s. Retry; it resumes from the failed stage.
- `/admin` — median upload→ready creeping past 150 s means Claude or Deezer is slow; nothing to do unless it fails.
- Anthropic console → Usage. Expect roughly $0.20–0.40 per submission. A spike means a retry loop; check for one submission with many `pipeline_failed` events in `events`.
- Vercel → Logs, filter `error`. 504 on `/api/submissions/*/run` means the function duration limit; see Deploy in README.

## Retry a submission
`/admin?status=failed` → retry. It re-runs from the failed stage. Candidates and recommendations for that submission are replaced, never duplicated.

## Fix a bad recommendation by hand
Supabase Studio → Table editor:
1. `recommendations` → filter `submission_id` → edit `title`, `artist`, `start_seconds`, `end_seconds`, `explanation`, `artwork_url`, `preview_url`, `spotify_url` directly. Rank stays 1–3. The creator's page shows the change on next load (it fetches live).
2. To swap in a different candidate: copy its row from `candidates` (same `submission_id`) into the recommendation row's fields; set `candidate_id` to that candidate's id.
3. To build a Spotify link by hand: `https://open.spotify.com/search/<Title>%20<Artist>`.
Log what you changed in `events` as `manual_fix` is NOT allowed (not in the list) — instead note it in this file's "Manual fixes" section below with the submission id.

## Overused songs
Edit `src/engine/scoring/config/overused.ts`: add `{ title, artist }` entries (normalised matching is case/punctuation-insensitive). Commit and push; Vercel redeploys in ~2 minutes. Entries get a 0.3 penalty on `originality`.

## Reading the metrics page for the deck
`/admin/metrics`:
- "Funnel → submission_created, creators" = creators who submitted (target 100).
- "Funnel → recommendations_ready, submissions" = results delivered.
- "recommendation_selected, submissions" ÷ "recommendations_viewed, submissions" = pick rate.
- "paid, creators" = paying creators (target 10). Cross-check against Stripe → Customers.
- "Median upload → ready" = time to result. "Median ready → selection" = decision time.
- "By category" = which niche picks most; use the select rate column.
- "Returning creators" = came back for a second video.

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

- [ ] Creator A (fresh Google account): upload → waiting → 3 results with previews → "Use this" on one → offer appears → "Get Songfit" → Stripe test checkout with `4242 4242 4242 4242` → lands on `/subscribe/thanks` → tap "Find my songs" → a second upload is accepted and produces results.
- [ ] Creator B (another Google account): first upload works; second upload attempt redirects to `/subscribe` with "You've used your free Songfit."
- [ ] Creator A rejects all three on the second result: "Want 3 different directions?" and the offer appear; `events` has `all_rejected` and `more_like_this_requested`.
- [ ] `/admin/metrics` shows: `submission_created` creators = 2, `paid` creators = 1, non-null medians, a category row, returning creators = 1.
- [ ] `/admin?status=failed` is empty, or every failed row has been retried to `ready`.
- [ ] `pnpm typecheck && pnpm test && pnpm build` pass on `main`; Vercel production deployment is green.
