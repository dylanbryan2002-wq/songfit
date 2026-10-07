## Phase 1 — Upload → stored submission

**Demo when done:** From an iPhone on cellular, against the deployed Vercel app: sign in with Google, pick a Reel, watch it upload with a progress bar (resumable for big files), land on a waiting page that polls a real `submissions` row.

Codex-review rulings applied in this phase (`docs/review/03-claude-rulings.md`): C2 (atomic paywall at creation, exact path binding, rate limits), C3/I2 (one runner entered via an atomic claim, run inside the submit route with `waitUntil`), C5 (`submissionId` prop, named `Logo` export, no raw errors to creators), C7 (deploy + phone test moved into this phase), I6 (sign in first, resumable uploads), I10 (honest failed state), M3 (admin gate per page/action, tight redirect allowlist, retention disclosure).

Assumes Phase 0 is complete: scaffold, `src/shared/{types,config,logger,errors,json,anthropic}.ts`, `src/db/client.ts` (`createServerClient`, `createServiceClient`), `src/db/browser.ts` (`createBrowserClient`), `src/db/queries/*`, `src/feedback/events.ts` (`EVENT_NAMES`, `logEvent`), `components/Logo.tsx` (named export `Logo`), `app/page.tsx` rendering a placeholder, `@vercel/functions` installed.

Phase 0 functions used here (signatures):

```ts
// src/shared/errors.ts
export class PaywallError extends Error { reason: "needs_subscription" }
// src/db/queries/creators.ts
export async function ensureCreator(id: string, email: string, displayName?: string | null): Promise<CreatorRow>; // CreatorRow has created_at
// src/db/queries/submissions.ts
export async function getSubmission(id: string): Promise<SubmissionRow | null>;
/** Calls the create_submission() SQL function: inserts the row AND enforces the paywall atomically. Throws PaywallError. Idempotent on id (returns the existing row for the same creator). */
export async function createSubmission(s: { id: string; creatorId: string; videoPath: string; creatorIntent: string | null }): Promise<SubmissionRow>;
/** Atomic conditional update: status → 'analyzing', updated_at = now() when status in ('uploaded','failed') OR updated_at older than LIMITS.inFlightStaleMinutes. Returns the row, or null when another run holds it. */
export async function claimSubmissionRun(id: string): Promise<SubmissionRow | null>;
export async function setSubmissionStatus(id: string, status: SubmissionStatus, error?: string | null): Promise<void>;
export async function countReadySubmissions(creatorId: string): Promise<number>;
export async function countSubmissionsForCreator(creatorId: string): Promise<number>;
// src/db/queries/subscriptions.ts
export async function getActiveSubscription(creatorId: string): Promise<{ id: string; status: string } | null>;
// src/db/queries/recommendations.ts
export async function listRecommendations(submissionId: string): Promise<RecommendationRow[]>;
```

`SubmissionRow` is `Database["public"]["Tables"]["submissions"]["Row"]` from `src/db/types.ts`. `RecommendationView` is the only recommendation shape that reaches the browser (`src/shared/types.ts`).

---

### Task 1.1: Auth — server session, admin gate, OAuth callback, middleware, client sign-in

**Files:**
- Create: `src/auth/admin.ts`
- Create: `src/auth/session.ts`
- Create: `app/auth/callback/route.ts`
- Create: `middleware.ts`
- Create: `components/auth.ts`
- Test: `tests/auth/admin.test.ts`

**Interfaces:**
- Consumes: `createServerClient()` from `src/db/client.ts` (returns a Supabase client bound to Next cookies), `createBrowserClient()` from `src/db/browser.ts`, `ensureCreator()` from `src/db/queries/creators.ts`, `logEvent()`.
- Produces:
  - `isAdminEmail(email: string | null | undefined, list: string): boolean` (pure)
  - `getCreator(): Promise<{ id: string; email: string } | null>`
  - `requireCreator(): Promise<{ id: string; email: string }>` — redirects to `/` when signed out
  - `requireAdmin(): Promise<{ id: string; email: string }>` — redirects to `/` unless admin. **Rule for Phases 2–4:** every `app/admin/**` page, route handler and server action calls `requireAdmin()` itself. The admin layout calling it is not enough (layouts don't re-run on client navigation and do not protect server actions).
  - `isAdmin(creator): boolean`
  - `signInWithGoogle(next: string): Promise<void>` (client)
- Redirect allowlist (Supabase → Authentication → URL Configuration) is exactly: `http://localhost:3000/**`, `http://<LAN-IP>:3000/**` while phone-testing locally, the exact production Vercel URL `https://<project>.vercel.app/**` once Task 1.7 creates it, and `https://thissongfits.com/**`. No `*.vercel.app` wildcard.

- [ ] **Step 1: Write the failing test for the admin email check**

```ts
// tests/auth/admin.test.ts
import { describe, expect, it } from "vitest";
import { isAdminEmail } from "../../src/auth/admin";

describe("isAdminEmail", () => {
  it("matches case-insensitively against a comma-separated list", () => {
    expect(isAdminEmail("Dylan@Gmail.com", "dylanbryan2002@gmail.com, dylan@gmail.com")).toBe(true);
  });
  it("ignores whitespace around entries", () => {
    expect(isAdminEmail("a@b.com", "  a@b.com  ,c@d.com")).toBe(true);
  });
  it("rejects emails not in the list", () => {
    expect(isAdminEmail("x@y.com", "a@b.com,c@d.com")).toBe(false);
  });
  it("rejects null/undefined/empty", () => {
    expect(isAdminEmail(null, "a@b.com")).toBe(false);
    expect(isAdminEmail(undefined, "a@b.com")).toBe(false);
    expect(isAdminEmail("", "a@b.com")).toBe(false);
    expect(isAdminEmail("a@b.com", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/auth/admin.test.ts`
Expected: FAIL — `Cannot find module '../../src/auth/admin'`

- [ ] **Step 3: Write the pure admin check**

```ts
// src/auth/admin.ts
export function isAdminEmail(email: string | null | undefined, list: string): boolean {
  if (!email || !list) return false;
  const needle = email.trim().toLowerCase();
  if (!needle) return false;
  return list
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(needle);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/auth/admin.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the server session helpers**

```ts
// src/auth/session.ts
import { redirect } from "next/navigation";
import { createServerClient } from "@/src/db/client";
import { ensureCreator } from "@/src/db/queries/creators";
import { isAdminEmail } from "./admin";

export type Creator = { id: string; email: string };

export async function getCreator(): Promise<Creator | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !data.user.email) return null;
  const creator = { id: data.user.id, email: data.user.email };
  // Idempotent mirror into public.creators so FK targets exist.
  await ensureCreator(
    creator.id,
    creator.email,
    (data.user.user_metadata?.full_name as string | undefined) ?? null,
  );
  return creator;
}

export async function requireCreator(): Promise<Creator> {
  const creator = await getCreator();
  if (!creator) redirect("/");
  return creator;
}

/** Call this in EVERY admin page, route handler and server action, not only in the admin layout. */
export async function requireAdmin(): Promise<Creator> {
  const creator = await getCreator();
  if (!creator || !isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "")) {
    redirect("/");
  }
  return creator;
}

export function isAdmin(creator: Creator | null): boolean {
  return !!creator && isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "");
}
```

- [ ] **Step 6: Write the OAuth callback route**

```ts
// app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createServerClient } from "@/src/db/client";
import { ensureCreator } from "@/src/db/queries/creators";
import { logEvent } from "@/src/feedback/events";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/";
  // Only allow same-origin relative paths to avoid open redirects.
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Mirror the user into public.creators and log signed_up the first time we see them.
      const { data } = await supabase.auth.getUser();
      if (data.user?.email) {
        const row = await ensureCreator(
          data.user.id,
          data.user.email,
          (data.user.user_metadata?.full_name as string | undefined) ?? null,
        );
        if (Date.now() - Date.parse(row.created_at) < 60_000) {
          await logEvent({ name: "signed_up", creatorId: row.id });
        }
      }
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }
  return NextResponse.redirect(new URL("/?auth=failed", url.origin));
}
```

- [ ] **Step 7: Write the middleware that refreshes the session cookie**

```ts
// middleware.ts
import { createServerClient as createSsrClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createSsrClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touching getUser() refreshes an expired access token and rewrites cookies.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 8: Write the client sign-in helper**

```ts
// components/auth.ts
"use client";
import { createBrowserClient } from "@/src/db/browser";

export async function signInWithGoogle(next: string): Promise<void> {
  const supabase = createBrowserClient();
  const origin = window.location.origin;
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const supabase = createBrowserClient();
  await supabase.auth.signOut();
  window.location.assign("/");
}
```

- [ ] **Step 9: Typecheck and run all tests**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck exits 0; vitest PASS including `tests/auth/admin.test.ts`

- [ ] **Step 10: Commit**

```bash
git add src/auth middleware.ts app/auth components/auth.ts tests/auth
git commit -m "Add Google auth session helpers, callback route and admin gate"
```

---

### Task 1.2: Signed upload URL, storage helpers, paywall pre-check, rate limit

**Files:**
- Create: `src/media/storage.ts`
- Create: `src/billing/paywall.ts`
- Create: `src/billing/rateLimit.ts`
- Modify: `src/db/queries/submissions.ts` (add `countInFlightSubmissions`, `countSubmissionsSince`)
- Create: `app/api/upload-url/route.ts`
- Test: `tests/billing/paywall.test.ts`, `tests/billing/rateLimit.test.ts`, `tests/media/storagePath.test.ts`

**Interfaces:**
- Consumes: `createServiceClient()` from `src/db/client.ts`, `LIMITS`, `FREE_RESULTS_PER_CREATOR` from `src/shared/config.ts`, `getCreator()` from `src/auth/session.ts`, `countReadySubmissions()` and `getActiveSubscription()` (Phase 0).
- Produces:
  - `storagePathFor(creatorId, submissionId, ext): string` and `isExactStoragePath(path, creatorId, submissionId, ext): boolean` (pure)
  - `getSignedUploadUrl(creatorId, submissionId, ext): Promise<{ path; token; signedUrl }>`
  - `objectInfo(storagePath): Promise<{ sizeBytes: number; mimeType: string | null } | null>`
  - `downloadToTmp(storagePath): Promise<string>` (local file path in a fresh temp dir)
  - `getSignedPlaybackUrl(storagePath, seconds = 3600): Promise<string>`
  - `decideCanSubmit(readyCount, inFlightCount, hasActiveSub): { ok: true } | { ok: false; reason: "needs_subscription" }` (pure). **This is a UX pre-check only.** The binding gate is the `create_submission()` SQL function Phase 0 created, which runs the same rule inside the database when the row is inserted (ruling C2).
  - `canSubmit(creatorId): Promise<ReturnType<typeof decideCanSubmit>>`
  - `takeToken(store, key, limit, windowMs, now?)` (pure over its store) and `checkUploadRate(creatorId): Promise<boolean>`
  - `POST /api/upload-url` → `200 { submissionId, path, token, signedUrl }` | `401` | `402 { reason: "needs_subscription" }` | `429` | `400`. The server chooses `path`; the client must upload to exactly that path and send it back unchanged.

- [ ] **Step 1: Write the failing paywall test**

```ts
// tests/billing/paywall.test.ts
import { describe, expect, it } from "vitest";
import { decideCanSubmit } from "../../src/billing/paywall";

describe("decideCanSubmit (UX pre-check mirroring create_submission())", () => {
  it("allows the first submission with no subscription", () => {
    expect(decideCanSubmit(0, 0, false)).toEqual({ ok: true });
  });
  it("blocks a second submission without an active subscription", () => {
    expect(decideCanSubmit(1, 0, false)).toEqual({ ok: false, reason: "needs_subscription" });
    expect(decideCanSubmit(5, 0, false)).toEqual({ ok: false, reason: "needs_subscription" });
  });
  it("counts an in-flight submission against the free allowance", () => {
    expect(decideCanSubmit(0, 1, false)).toEqual({ ok: false, reason: "needs_subscription" });
  });
  it("allows any submission with an active subscription", () => {
    expect(decideCanSubmit(0, 0, true)).toEqual({ ok: true });
    expect(decideCanSubmit(9, 2, true)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/billing/paywall.test.ts`
Expected: FAIL — `Cannot find module '../../src/billing/paywall'`

- [ ] **Step 3: Add the two count queries, then write the paywall module**

Append to `src/db/queries/submissions.ts`:

```ts
/** In-flight = uploaded/analyzing/recommending and touched within the stale window. Mirrors create_submission(). */
export async function countInFlightSubmissions(creatorId: string, staleMinutes: number): Promise<number> {
  const since = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .in("status", ["uploaded", "analyzing", "recommending"])
    .gte("updated_at", since);
  if (error) throw error;
  return count ?? 0;
}

export async function countSubmissionsSince(creatorId: string, sinceIso: string): Promise<number> {
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .gte("created_at", sinceIso);
  if (error) throw error;
  return count ?? 0;
}
```

```ts
// src/billing/paywall.ts
import { countInFlightSubmissions, countReadySubmissions } from "@/src/db/queries/submissions";
import { getActiveSubscription } from "@/src/db/queries/subscriptions";
import { FREE_RESULTS_PER_CREATOR, LIMITS } from "@/src/shared/config";

export type CanSubmit = { ok: true } | { ok: false; reason: "needs_subscription" };

/**
 * UX pre-check. The database function create_submission() applies the same
 * rule atomically at insert time; this only exists so the client can show the
 * paywall before uploading 100 MB.
 */
export function decideCanSubmit(readyCount: number, inFlightCount: number, hasActiveSub: boolean): CanSubmit {
  if (hasActiveSub) return { ok: true };
  if (readyCount + inFlightCount >= FREE_RESULTS_PER_CREATOR) return { ok: false, reason: "needs_subscription" };
  return { ok: true };
}

export async function canSubmit(creatorId: string): Promise<CanSubmit> {
  const [readyCount, inFlight, sub] = await Promise.all([
    countReadySubmissions(creatorId),
    countInFlightSubmissions(creatorId, LIMITS.inFlightStaleMinutes),
    getActiveSubscription(creatorId),
  ]);
  return decideCanSubmit(readyCount, inFlight, sub !== null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/billing/paywall.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing tests for the storage path check and the rate limiter**

```ts
// tests/media/storagePath.test.ts
import { describe, expect, it } from "vitest";
import { isExactStoragePath, storagePathFor } from "../../src/media/storage";

const c = "11111111-1111-1111-1111-111111111111";
const s = "22222222-2222-2222-2222-222222222222";

describe("storagePathFor / isExactStoragePath", () => {
  it("builds creator/submission.ext", () => {
    expect(storagePathFor(c, s, "mov")).toBe(`${c}/${s}.mov`);
  });
  it("accepts only the exact path", () => {
    expect(isExactStoragePath(`${c}/${s}.mov`, c, s, "mov")).toBe(true);
    expect(isExactStoragePath(`${c}/${s}.mp4`, c, s, "mov")).toBe(false);
    expect(isExactStoragePath(`${c}/other.mov`, c, s, "mov")).toBe(false);
    expect(isExactStoragePath(`${c}/../${c}/${s}.mov`, c, s, "mov")).toBe(false);
    expect(isExactStoragePath(`${c}/${s}.mov/`, c, s, "mov")).toBe(false);
  });
});
```

```ts
// tests/billing/rateLimit.test.ts
import { describe, expect, it } from "vitest";
import { takeToken } from "../../src/billing/rateLimit";

describe("takeToken", () => {
  it("allows up to the limit inside the window, then refuses", () => {
    const store = new Map<string, number[]>();
    let now = 1_000_000;
    for (let i = 0; i < 5; i++) expect(takeToken(store, "c1", 5, 60_000, now)).toBe(true);
    expect(takeToken(store, "c1", 5, 60_000, now)).toBe(false);
    now += 60_001;
    expect(takeToken(store, "c1", 5, 60_000, now)).toBe(true);
  });
  it("keys are independent", () => {
    const store = new Map<string, number[]>();
    for (let i = 0; i < 5; i++) takeToken(store, "a", 5, 60_000, 0);
    expect(takeToken(store, "b", 5, 60_000, 0)).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm vitest run tests/media/storagePath.test.ts tests/billing/rateLimit.test.ts`
Expected: FAIL — cannot find modules

- [ ] **Step 7: Write the storage helpers**

```ts
// src/media/storage.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/src/db/client";

export const VIDEO_BUCKET = "videos";

export function storagePathFor(creatorId: string, submissionId: string, ext: string): string {
  return `${creatorId}/${submissionId}.${ext}`;
}

/** Exact string equality against the server-built path. No prefix logic, no normalisation. */
export function isExactStoragePath(candidate: string, creatorId: string, submissionId: string, ext: string): boolean {
  return candidate === storagePathFor(creatorId, submissionId, ext);
}

export async function getSignedUploadUrl(
  creatorId: string,
  submissionId: string,
  ext: string,
): Promise<{ path: string; token: string; signedUrl: string }> {
  const supabase = createServiceClient();
  const objectPath = storagePathFor(creatorId, submissionId, ext);
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUploadUrl(objectPath);
  if (error || !data) throw new Error(`createSignedUploadUrl failed: ${error?.message}`);
  return { path: data.path, token: data.token, signedUrl: data.signedUrl };
}

/** Size and type of a stored object, or null when it doesn't exist. */
export async function objectInfo(
  storagePath: string,
): Promise<{ sizeBytes: number; mimeType: string | null } | null> {
  const supabase = createServiceClient();
  const dir = path.posix.dirname(storagePath);
  const name = path.posix.basename(storagePath);
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).list(dir, { search: name });
  if (error) throw new Error(`storage list failed: ${error.message}`);
  const obj = (data ?? []).find((o) => o.name === name);
  if (!obj) return null;
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  return { sizeBytes: Number(meta.size ?? 0), mimeType: meta.mimetype ?? null };
}

/**
 * Downloads the object into a fresh private directory (`/tmp/songfit-<random>/video.<ext>`)
 * so callers can `rm -rf path.dirname(result)` safely when done (Phase 2 relies on this).
 */
export async function downloadToTmp(storagePath: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).download(storagePath);
  if (error || !data) throw new Error(`storage download failed: ${error?.message}`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "songfit-"));
  const ext = path.posix.extname(storagePath) || ".mp4";
  const localPath = path.join(dir, `video${ext}`);
  await writeFile(localPath, Buffer.from(await data.arrayBuffer()));
  return localPath;
}

export async function getSignedPlaybackUrl(storagePath: string, seconds = 3600): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(storagePath, seconds);
  if (error || !data) throw new Error(`createSignedUrl failed: ${error?.message}`);
  return data.signedUrl;
}
```

- [ ] **Step 8: Write the rate limiter**

```ts
// src/billing/rateLimit.ts
import { countSubmissionsSince } from "@/src/db/queries/submissions";

export const UPLOAD_URL_LIMIT = 5;
export const UPLOAD_URL_WINDOW_MS = 60_000;

/**
 * Sliding-window token take. Pure over the store it is given so it is testable.
 * The module-level store is PER SERVER INSTANCE: on Vercel each function
 * instance has its own map, so this is a best-effort second guard. The
 * database count in checkUploadRate() is the one that holds across instances.
 */
export function takeToken(
  store: Map<string, number[]>,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  const recent = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    store.set(key, recent);
    return false;
  }
  recent.push(now);
  store.set(key, recent);
  return true;
}

const issuances = new Map<string, number[]>();

/** True when this creator may be issued another upload URL right now. */
export async function checkUploadRate(creatorId: string): Promise<boolean> {
  const since = new Date(Date.now() - UPLOAD_URL_WINDOW_MS).toISOString();
  const created = await countSubmissionsSince(creatorId, since);
  if (created >= UPLOAD_URL_LIMIT) return false;
  return takeToken(issuances, creatorId, UPLOAD_URL_LIMIT, UPLOAD_URL_WINDOW_MS);
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm vitest run tests/media/storagePath.test.ts tests/billing/rateLimit.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 10: Write the upload-url route**

```ts
// app/api/upload-url/route.ts
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { canSubmit } from "@/src/billing/paywall";
import { checkUploadRate } from "@/src/billing/rateLimit";
import { getSignedUploadUrl } from "@/src/media/storage";
import { LIMITS } from "@/src/shared/config";

export const dynamic = "force-dynamic";

const Body = z.object({
  ext: z.enum(["mp4", "mov", "webm", "m4v"]),
  sizeBytes: z.number().int().positive().max(LIMITS.maxUploadBytes),
});

export async function POST(request: Request) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!(await checkUploadRate(creator.id))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const gate = await canSubmit(creator.id);
  if (!gate.ok) return NextResponse.json({ reason: gate.reason }, { status: 402 });

  const submissionId = randomUUID();
  const { path, token, signedUrl } = await getSignedUploadUrl(creator.id, submissionId, parsed.data.ext);
  return NextResponse.json({ submissionId, path, token, signedUrl });
}
```

- [ ] **Step 11: Typecheck and run all tests**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck exits 0; vitest PASS

- [ ] **Step 12: Manual check (browser console while signed in on `http://localhost:3000`)**

```js
await fetch("/api/upload-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ext: "mp4", sizeBytes: 1000 }) }).then(r => r.json())
```

Expected: `{ submissionId: "<uuid>", path: "<creatorId>/<uuid>.mp4", token: "...", signedUrl: "https://..." }`. Signed out: `401`. Run it 6 times in a row: the 6th returns `429`.

- [ ] **Step 13: Commit**

```bash
git add src/media/storage.ts src/billing src/db/queries/submissions.ts app/api/upload-url tests/billing tests/media
git commit -m "Add signed upload URL route, storage helpers, paywall pre-check and rate limit"
```

---

### Task 1.3: Submission creation (atomic paywall), in-route pipeline run, admin run route, status endpoint

**Files:**
- Create: `src/pipeline/run.ts` (stub for this phase; Phase 2 fills the body, signature is final)
- Create: `app/api/submissions/route.ts`
- Create: `app/api/submissions/[id]/run/route.ts`
- Create: `app/api/submissions/[id]/route.ts`
- Create: `src/feedback/recommendationView.ts`
- Test: `tests/feedback/recommendationView.test.ts`

**Interfaces:**
- Consumes: `getCreator()`, `isAdmin()`, `isExactStoragePath()`, `objectInfo()`, `createSubmission()` (throws `PaywallError`), `claimSubmissionRun()`, `getSubmission()`, `listRecommendations()`, `countSubmissionsForCreator()`, `logEvent()`, `env()`, `waitUntil` from `@vercel/functions`.
- Produces:
  - `runSubmission(submissionId: string): Promise<void>` — never throws; claims the run via `claimSubmissionRun` first.
  - `toRecommendationView(row: RecommendationRow): RecommendationView` (pure)
  - `POST /api/submissions` body `{ submissionId, path, ext, creatorIntent }` → `201 { id }` | `200 { id }` (already existed) | `402 { reason }` | `400` | `401`. Runs the pipeline in-process via `waitUntil`; `maxDuration = 300`.
  - `POST /api/submissions/[id]/run` header `x-internal-token` → `200 { ok: true }` | `409` (claim refused) — **admin retry only**.
  - `GET /api/submissions/[id]` → `200 { status, error: "failed" | null, recommendations: RecommendationView[] }` | `404`. Raw error text never leaves the server.

- [ ] **Step 1: Write the failing test for the view mapper**

```ts
// tests/feedback/recommendationView.test.ts
import { describe, expect, it } from "vitest";
import { toRecommendationView } from "../../src/feedback/recommendationView";

describe("toRecommendationView", () => {
  it("exposes only creator-facing fields", () => {
    const row = {
      id: "r1", submission_id: "s1", candidate_id: "c1", rank: 1, direction_label: "Best fit",
      title: "Song", artist: "Artist", start_seconds: 43, end_seconds: 58, explanation: "Why.",
      spotify_url: "https://open.spotify.com/search/Song%20Artist", deezer_url: "https://deezer.com/track/1",
      artwork_url: null, preview_url: null, selected: false, rejected: false, created_at: "2026-10-06T00:00:00Z",
      explain_prompt_version: "explain-v1",
    };
    expect(toRecommendationView(row as never)).toEqual({
      rank: 1, direction_label: "Best fit", title: "Song", artist: "Artist",
      start_seconds: 43, end_seconds: 58, explanation: "Why.", artwork_url: null, preview_url: null,
      spotify_url: "https://open.spotify.com/search/Song%20Artist", selected: false, rejected: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/feedback/recommendationView.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the view mapper**

```ts
// src/feedback/recommendationView.ts
import type { RecommendationRow } from "@/src/db/queries/recommendations";
import { RecommendationView } from "@/src/shared/types";

/** The ONLY shape that reaches the browser. Validated with Zod so a schema drift fails loudly. */
export function toRecommendationView(row: RecommendationRow): RecommendationView {
  // `selected` / `rejected` columns arrive with Phase 4's migration; until then the generated
  // Row type lacks them. Remove this cast in Task 4.1.
  const flags = row as { selected?: boolean | null; rejected?: boolean | null };
  return RecommendationView.parse({
    rank: row.rank,
    direction_label: row.direction_label,
    title: row.title,
    artist: row.artist,
    start_seconds: Number(row.start_seconds),
    end_seconds: Number(row.end_seconds),
    explanation: row.explanation,
    artwork_url: row.artwork_url,
    preview_url: row.preview_url,
    spotify_url: row.spotify_url,
    selected: flags.selected ?? false,
    rejected: flags.rejected ?? false,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/feedback/recommendationView.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Write the pipeline stub with the atomic claim**

```ts
// src/pipeline/run.ts
import { claimSubmissionRun } from "@/src/db/queries/submissions";
import { logger } from "@/src/shared/logger";

/**
 * Runs the full pipeline for a submission. Entered only through claimSubmissionRun(),
 * an atomic conditional update, so two concurrent callers cannot both run it.
 * Phase 1 stub: claim, log, return (status is now 'analyzing'). Phase 2 adds the
 * analyze stage, Phase 3 adds recommend. Never throws.
 */
export async function runSubmission(submissionId: string): Promise<void> {
  const claimed = await claimSubmissionRun(submissionId);
  if (!claimed) {
    logger.info("pipeline.claim_refused", { submissionId });
    return;
  }
  logger.info("pipeline.start", { submissionId });
}
```

- [ ] **Step 6: Write the submission creation route (runs the pipeline in-process)**

```ts
// app/api/submissions/route.ts
import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { createSubmission, countSubmissionsForCreator, getSubmission } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";
import { isExactStoragePath, objectInfo } from "@/src/media/storage";
import { runSubmission } from "@/src/pipeline/run";
import { LIMITS } from "@/src/shared/config";
import { PaywallError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";

// The pipeline runs inside this request via waitUntil, so this route needs the full budget.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const Body = z.object({
  submissionId: z.string().uuid(),
  path: z.string().min(1).max(200),
  ext: z.enum(["mp4", "mov", "webm", "m4v"]),
  creatorIntent: z.string().trim().max(300).nullable().optional(),
});

export async function POST(request: Request) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { submissionId, path, ext, creatorIntent } = parsed.data;

  // Idempotent: a retried POST for an id this creator already owns returns it unchanged.
  const existing = await getSubmission(submissionId);
  if (existing) {
    if (existing.creator_id !== creator.id) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ id: existing.id }, { status: 200 });
  }

  // The path must be exactly the one the server issued for this creator + id + ext.
  if (!isExactStoragePath(path, creator.id, submissionId, ext)) {
    return NextResponse.json({ error: "forbidden_path" }, { status: 403 });
  }
  const info = await objectInfo(path);
  if (!info) return NextResponse.json({ error: "upload_not_found" }, { status: 400 });
  if (info.sizeBytes > LIMITS.maxUploadBytes) return NextResponse.json({ error: "too_large" }, { status: 400 });

  let submission;
  try {
    submission = await createSubmission({
      id: submissionId,
      creatorId: creator.id,
      videoPath: path,
      creatorIntent: creatorIntent?.length ? creatorIntent : null,
    });
  } catch (err) {
    if (err instanceof PaywallError) return NextResponse.json({ reason: err.reason }, { status: 402 });
    logger.error("submission.create_failed", { submissionId, err: String(err) });
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }

  await logEvent({ name: "submission_created", creatorId: creator.id, submissionId: submission.id });
  await logEvent({ name: "upload_completed", creatorId: creator.id, submissionId: submission.id });
  if ((await countSubmissionsForCreator(creator.id)) >= 2) {
    await logEvent({ name: "returned_with_second_submission", creatorId: creator.id, submissionId: submission.id });
  }

  // Run the pipeline in this function. waitUntil keeps the instance alive after the
  // response is sent (Vercel); locally it resolves like a normal background promise.
  waitUntil(
    runSubmission(submission.id).catch((err) =>
      logger.error("pipeline.unhandled", { submissionId: submission.id, err: String(err) }),
    ),
  );

  return NextResponse.json({ id: submission.id }, { status: 201 });
}
```

Known limitation (write it in README under "Known limitations"): `waitUntil` is not durable. If the instance dies mid-run the status stays in-flight; after `LIMITS.inFlightStaleMinutes` the claim becomes available again and the admin Retry (Phase 2) re-runs it.

- [ ] **Step 7: Write the admin-retry run route**

```ts
// app/api/submissions/[id]/run/route.ts
import { NextResponse } from "next/server";
import { getSubmission } from "@/src/db/queries/submissions";
import { runSubmission } from "@/src/pipeline/run";
import { env } from "@/src/shared/config";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Admin retry entry point. Protected by the shared INTERNAL_TOKEN; goes through the same atomic claim. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = request.headers.get("x-internal-token");
  if (!token || token !== env("INTERNAL_TOKEN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const before = await getSubmission(id);
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await runSubmission(id); // never throws; refuses internally when the claim fails
  const after = await getSubmission(id);
  if (after && before.status === after.status && before.updated_at === after.updated_at) {
    return NextResponse.json({ ok: false, error: "claim_refused" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 8: Write the status route**

```ts
// app/api/submissions/[id]/route.ts
import { NextResponse } from "next/server";
import { getCreator, isAdmin } from "@/src/auth/session";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { getSubmission } from "@/src/db/queries/submissions";
import { toRecommendationView } from "@/src/feedback/recommendationView";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await ctx.params;
  const submission = await getSubmission(id);
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.creator_id !== creator.id && !isAdmin(creator)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const recommendations =
    submission.status === "ready" ? (await listRecommendations(id)).map(toRecommendationView) : [];

  return NextResponse.json({
    status: submission.status,
    error: submission.status === "failed" ? "failed" : null, // never the raw message
    recommendations,
  });
}
```

- [ ] **Step 9: Typecheck and run tests**

Run: `pnpm typecheck && pnpm test`
Expected: exits 0; PASS

- [ ] **Step 10: Manual check of the run route token guard**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/submissions/00000000-0000-0000-0000-000000000000/run`
Expected: `403`

Run: `curl -s -X POST -H "x-internal-token: $(grep INTERNAL_TOKEN .env.local | cut -d= -f2)" http://localhost:3000/api/submissions/00000000-0000-0000-0000-000000000000/run`
Expected: `{"error":"not_found"}` with 404 — proves the guard passed.

- [ ] **Step 11: Commit**

```bash
git add src/pipeline/run.ts src/feedback/recommendationView.ts app/api/submissions tests/feedback
git commit -m "Add atomic submission creation, in-route pipeline run, admin run route and status endpoint"
```

---

### Task 1.4: Sign in first, then UploadForm with resumable upload

**Files:**
- Create: `components/fileExt.ts`
- Create: `components/videoDuration.ts`
- Create: `components/upload.ts`
- Create: `components/SignIn.tsx`
- Create: `components/UploadForm.tsx`
- Modify: `app/page.tsx`
- Modify: `package.json` (add `tus-js-client`)
- Test: `tests/components/fileExt.test.ts`

**Interfaces:**
- Consumes: `signInWithGoogle()` from `components/auth.ts`, `createBrowserClient()` from `src/db/browser.ts`, `LIMITS` from `src/shared/config.ts`, `POST /api/upload-url`, `POST /api/submissions`.
- Produces:
  - `fileExt(file: { name: string; type: string }): "mp4" | "mov" | "webm" | "m4v" | null` (pure)
  - `readVideoDuration(file: File): Promise<number>` (client)
  - `uploadVideo(args: { file, path, token, signedUrl, onProgress }): Promise<void>` (client; TUS resumable above 6 MB, signed PUT at or below)
  - `<SignIn />` — the signed-out landing: one "Continue with Google" button plus the retention line
  - `<UploadForm creator={Creator} />` — only rendered when signed in
- Product decision (ruling I6 default): sign-in happens BEFORE picking a file. Nothing is stashed across the OAuth redirect.

- [ ] **Step 1: Write the failing test for extension detection**

```ts
// tests/components/fileExt.test.ts
import { describe, expect, it } from "vitest";
import { fileExt } from "../../components/fileExt";

describe("fileExt", () => {
  it("uses the filename extension when recognised", () => {
    expect(fileExt({ name: "clip.MOV", type: "video/quicktime" })).toBe("mov");
    expect(fileExt({ name: "clip.mp4", type: "video/mp4" })).toBe("mp4");
    expect(fileExt({ name: "clip.webm", type: "video/webm" })).toBe("webm");
    expect(fileExt({ name: "clip.m4v", type: "video/x-m4v" })).toBe("m4v");
  });
  it("falls back to the mime type when the name has no usable extension", () => {
    expect(fileExt({ name: "image", type: "video/quicktime" })).toBe("mov");
    expect(fileExt({ name: "blob", type: "video/mp4" })).toBe("mp4");
  });
  it("returns null for unsupported files", () => {
    expect(fileExt({ name: "a.avi", type: "video/x-msvideo" })).toBeNull();
    expect(fileExt({ name: "a.jpg", type: "image/jpeg" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/components/fileExt.test.ts`
Expected: FAIL — `Cannot find module '../../components/fileExt'`

- [ ] **Step 3: Write the pure helper**

```ts
// components/fileExt.ts
export type VideoExt = "mp4" | "mov" | "webm" | "m4v";

const BY_EXT: Record<string, VideoExt> = { mp4: "mp4", mov: "mov", webm: "webm", m4v: "m4v" };
const BY_MIME: Record<string, VideoExt> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
};

export function fileExt(file: { name: string; type: string }): VideoExt | null {
  const dot = file.name.lastIndexOf(".");
  if (dot > -1) {
    const ext = file.name.slice(dot + 1).toLowerCase();
    if (BY_EXT[ext]) return BY_EXT[ext];
  }
  return BY_MIME[file.type.toLowerCase()] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/components/fileExt.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the duration reader**

```ts
// components/videoDuration.ts
"use client";

/** Resolves the duration in seconds by loading metadata into a detached <video>. */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const d = video.duration;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(d)) reject(new Error("Could not read video duration"));
      else resolve(d);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this video"));
    };
    video.src = url;
  });
}
```

- [ ] **Step 6: Install tus and write the uploader**

Run: `pnpm add tus-js-client`

Supabase Storage exposes a TUS endpoint at `/storage/v1/upload/resumable`. Chunks are exactly 6 MB; the user's access token authorises the write and the Storage INSERT policy (Phase 0, `0003_rls.sql`) restricts it to `{auth.uid()}/…` paths, which is why the client must use the server-issued `path` verbatim.

```ts
// components/upload.ts
"use client";
import * as tus from "tus-js-client";
import { createBrowserClient } from "@/src/db/browser";

const SIX_MB = 6 * 1024 * 1024;

export async function uploadVideo(args: {
  file: File;
  path: string;
  token: string;
  signedUrl: string;
  onProgress: (pct: number) => void;
}): Promise<void> {
  if (args.file.size <= SIX_MB) return putToSignedUrl(args.signedUrl, args.file, args.onProgress);
  return resumableUpload(args.file, args.path, args.onProgress);
}

/** Small files: one PUT to the signed upload URL (token is in the URL). */
function putToSignedUrl(signedUrl: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload_${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload_network"));
    xhr.onabort = () => reject(new Error("upload_aborted"));
    xhr.send(file);
  });
}

/** Big files: TUS resumable upload with automatic retry, survives flaky cellular. */
async function resumableUpload(file: File, objectName: string, onProgress: (pct: number) => void): Promise<void> {
  const supabase = createBrowserClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("not_signed_in");

  const endpoint = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`;

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 1000, 3000, 5000],
      chunkSize: SIX_MB, // Supabase requires exactly 6 MB chunks
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-upsert": "false",
      },
      metadata: {
        bucketName: "videos",
        objectName,
        contentType: file.type || "video/mp4",
        cacheControl: "3600",
      },
      onError: (err) => reject(err),
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onSuccess: () => resolve(),
    });
    // Resume a previous attempt of the same file if the browser kept its fingerprint.
    upload.findPreviousUploads().then((prev) => {
      if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    });
  });
}
```

- [ ] **Step 7: Write the signed-out landing**

```tsx
// components/SignIn.tsx
"use client";
import { useState } from "react";
import { signInWithGoogle } from "./auth";

export function SignIn() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await signInWithGoogle("/");
          } finally {
            setBusy(false);
          }
        }}
        className="w-full rounded-2xl bg-neutral-900 px-5 py-4 text-base font-semibold text-white disabled:opacity-60"
      >
        Continue with Google
      </button>
      <p className="px-4 text-center text-xs text-neutral-500">
        Your video is stored privately and analysed by AI services to find your songs. Nothing is posted anywhere.
      </p>
    </div>
  );
}
```

- [ ] **Step 8: Write the UploadForm component (signed-in only)**

```tsx
// components/UploadForm.tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fileExt } from "./fileExt";
import { readVideoDuration } from "./videoDuration";
import { uploadVideo } from "./upload";
import { LIMITS } from "@/src/shared/config";

type Creator = { id: string; email: string };
type Phase = "idle" | "checking" | "uploading" | "creating" | "error";

export function UploadForm({ creator }: { creator: Creator }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [intent, setIntent] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setFile(e.target.files?.[0] ?? null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) {
      setError("Pick a video first.");
      return;
    }
    const ext = fileExt(file);
    if (!ext) {
      setError("That file type isn't supported. Use MP4, MOV or WebM.");
      return;
    }
    if (file.size > LIMITS.maxUploadBytes) {
      setError("That video is over 150 MB. Try a shorter export.");
      return;
    }

    try {
      setPhase("checking");
      const duration = await readVideoDuration(file);
      if (duration > LIMITS.maxDurationSeconds) {
        setError("Keep it under 3 minutes for now.");
        setPhase("idle");
        return;
      }

      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ext, sizeBytes: file.size }),
      });
      if (urlRes.status === 402) {
        router.push("/subscribe");
        return;
      }
      if (urlRes.status === 429) throw new Error("Give it a minute and try again.");
      if (!urlRes.ok) throw new Error("Upload didn't finish. Try again.");
      const { submissionId, path, token, signedUrl } = (await urlRes.json()) as {
        submissionId: string;
        path: string;
        token: string;
        signedUrl: string;
      };

      setPhase("uploading");
      setProgress(0);
      await uploadVideo({ file, path, token, signedUrl, onProgress: setProgress });

      setPhase("creating");
      const createRes = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId, path, ext, creatorIntent: intent.trim() || null }),
      });
      if (createRes.status === 402) {
        router.push("/subscribe");
        return;
      }
      if (!createRes.ok) throw new Error("Upload didn't finish. Try again.");
      const { id } = (await createRes.json()) as { id: string };
      router.push(`/results/${id}`);
    } catch (err) {
      setPhase("error");
      const msg = err instanceof Error ? err.message : "";
      setError(msg.startsWith("Give it") || msg.startsWith("Upload didn't") ? msg : "Upload didn't finish. Try again.");
    }
  }

  const busy = phase === "checking" || phase === "uploading" || phase === "creating";

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-md flex-col gap-5">
      <label
        htmlFor="video"
        className="flex aspect-[9/12] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm active:scale-[0.99]"
      >
        {previewUrl ? (
          <video src={previewUrl} muted playsInline className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 text-center">
            <span className="text-lg font-semibold text-neutral-900">Tap to add your Reel</span>
            <span className="text-sm text-neutral-500">MP4 or MOV, up to 3 minutes</span>
          </div>
        )}
        <input id="video" type="file" accept="video/*" className="sr-only" onChange={onPick} disabled={busy} />
      </label>

      {file && <p className="truncate text-center text-sm text-neutral-500">{file.name}</p>}

      <input
        type="text"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        maxLength={300}
        placeholder="What do you want this to feel like? (optional)"
        className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-400"
        disabled={busy}
      />

      {phase === "uploading" && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full bg-neutral-900 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-2xl bg-neutral-900 px-5 py-4 text-base font-semibold text-white disabled:opacity-60"
      >
        {phase === "checking" && "Checking your video"}
        {phase === "uploading" && `Uploading ${progress}%`}
        {phase === "creating" && "Almost there"}
        {(phase === "idle" || phase === "error") && "Find my songs"}
      </button>
      <p className="text-center text-xs text-neutral-400">Signed in as {creator.email}</p>
    </form>
  );
}
```

- [ ] **Step 9: Wire the page: sign-in first**

```tsx
// app/page.tsx
import { getCreator } from "@/src/auth/session";
import { Logo } from "@/components/Logo";
import { SignIn } from "@/components/SignIn";
import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const creator = await getCreator();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-8 px-4 pb-10 pt-10">
      <Logo />
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          Find the right song for your content.
        </h1>
        <p className="text-base text-neutral-500">
          Upload your Reel and Songfit will find the songs that fit it best, and exactly which part to use.
        </p>
      </div>
      {creator ? <UploadForm creator={creator} /> : <SignIn />}
    </main>
  );
}
```

- [ ] **Step 10: Typecheck and run tests**

Run: `pnpm typecheck && pnpm test`
Expected: exits 0; PASS including `tests/components/fileExt.test.ts`

- [ ] **Step 11: Manual check in the browser**

1. `pnpm dev`, open `http://localhost:3000` signed out. Expected: headline, subline, one "Continue with Google" button, the retention line. No file picker.
2. Tap it → Google → back on `/` showing the upload form and "Signed in as …".
3. Pick a 3 MB MP4, tap "Find my songs". Expected: "Uploading NN%", then `/results/<uuid>`.
4. Pick a 40 MB MOV. Expected: progress climbs in ~6 MB steps (TUS), then `/results/<uuid>`. In Supabase Studio → Storage → `videos` → `<creatorId>/<uuid>.mov` exists; `submissions` has a row with `status = analyzing`.
5. Toggle devtools → Network → Offline for 5 s during step 4, then back online. Expected: the upload resumes and completes.

- [ ] **Step 12: Commit**

```bash
git add components/UploadForm.tsx components/SignIn.tsx components/fileExt.ts components/videoDuration.ts components/upload.ts app/page.tsx package.json pnpm-lock.yaml tests/components
git commit -m "Add sign-in-first landing and resumable upload form"
```

---

### Task 1.5: Waiting page with status polling and an honest failed state

**Files:**
- Create: `app/results/[id]/page.tsx`
- Create: `components/WaitingState.tsx`
- Modify: `app/globals.css` (keyframes)

**Interfaces:**
- Consumes: `getCreator()`, `isAdmin()`, `getSubmission()`, `GET /api/submissions/[id]`.
- Produces: `<WaitingState submissionId={string} initialStatus={string} />`; `/results/[id]` renders the waiting state until `status === "ready"`, then a placeholder (Phase 3 replaces the placeholder with the results list).
- On `failed`: polling stops and the page says "Something went wrong on our side. We're on it." The admin Retry (Phase 2) puts it back in flight; the creator can reload.

- [ ] **Step 1: Add the keyframes to `app/globals.css`**

```css
@keyframes slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
```

- [ ] **Step 2: Write the WaitingState client component**

```tsx
// components/WaitingState.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const LINES = ["Watching your video", "Understanding the feel", "Finding your songs"];
const POLL_MS = 3000;
const LINE_MS = 4000;
const SLOW_AFTER_MS = 240_000;

type Status = "uploaded" | "analyzing" | "recommending" | "ready" | "failed";

export function WaitingState({ submissionId, initialStatus }: { submissionId: string; initialStatus: Status }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [lineIdx, setLineIdx] = useState(0);
  const [slow, setSlow] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (status === "failed") return;
    const t = setInterval(() => setLineIdx((i) => (i + 1) % LINES.length), LINE_MS);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (status === "failed") return;
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(`/api/submissions/${submissionId}`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { status: Status };
          if (cancelled) return;
          if (body.status === "ready") {
            router.refresh();
            return;
          }
          if (body.status === "failed") {
            setStatus("failed");
            return;
          }
        }
      } catch {
        /* transient network error: keep polling */
      }
      if (!cancelled && Date.now() - startedAt.current > SLOW_AFTER_MS) setSlow(true);
      if (!cancelled) setTimeout(tick, POLL_MS);
    }
    void tick();
    return () => {
      cancelled = true;
    };
  }, [submissionId, router, status]);

  if (status === "failed") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-lg font-medium text-neutral-900">Something went wrong on our side.</p>
        <p className="text-sm text-neutral-500">We&apos;re on it. Check back in a bit.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-neutral-900" />
      </div>
      <p className="text-lg font-medium text-neutral-900" aria-live="polite">
        {LINES[lineIdx]}
      </p>
      {slow && (
        <p className="text-sm text-neutral-500">This is taking longer than usual, we&apos;ll keep trying.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the results page (waiting branch now, results branch in Phase 3)**

```tsx
// app/results/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { getCreator, isAdmin } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { Logo } from "@/components/Logo";
import { WaitingState } from "@/components/WaitingState";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, creator] = await Promise.all([params, getCreator()]);
  if (!creator) redirect("/");

  const submission = await getSubmission(id);
  if (!submission) notFound();
  if (submission.creator_id !== creator.id && !isAdmin(creator)) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-10 px-4 pb-10 pt-10">
      <Logo />
      {submission.status === "ready" ? (
        // Phase 3 replaces this block with the recommendation cards.
        <h1 className="text-2xl font-semibold text-neutral-900">Ready</h1>
      ) : (
        <WaitingState
          submissionId={id}
          initialStatus={submission.status as "uploaded" | "analyzing" | "recommending" | "failed"}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0

- [ ] **Step 5: Manual check**

1. Upload a video (Task 1.4). Expected: `/results/<id>` shows the sliding bar and the rotating lines, changing every 4 s.
2. In Supabase Studio, set that row's `status` to `ready`. Expected: within 3 s the page shows "Ready".
3. Set it to `failed`. Expected: within 3 s the page shows "Something went wrong on our side." and the Network tab shows polling has stopped.
4. Open the same URL in a private window signed in as a different Google account. Expected: 404.

- [ ] **Step 6: Commit**

```bash
git add app/results components/WaitingState.tsx app/globals.css
git commit -m "Add waiting page with status polling and failed state"
```

---

### Task 1.6: Google provider setup (Dylan, no code)

**Files:** none. Supabase dashboard + Google Cloud Console.

**Interfaces:**
- Produces: a working Google provider on the Supabase project, with a tight redirect allowlist.

- [ ] **Step 1: Google Cloud Console — OAuth consent screen**

1. Go to `https://console.cloud.google.com/`, create or select a project named `Songfit`.
2. APIs & Services → OAuth consent screen → User type **External** → Create.
3. App name `Songfit`, user support email = your Gmail, developer contact = your Gmail. Save.
4. Scopes → Add → tick `.../auth/userinfo.email` and `.../auth/userinfo.profile` → Update → Save.
5. Publishing status: click **Publish app** so any Google account can sign in (otherwise only listed test users can).

- [ ] **Step 2: Google Cloud Console — OAuth client**

1. APIs & Services → Credentials → Create credentials → **OAuth client ID** → Application type **Web application**, name `Songfit web`.
2. Authorized JavaScript origins: `http://localhost:3000`, `https://thissongfits.com`. (Add the exact Vercel URL after Task 1.7.)
3. Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback` (project ref from Supabase → Settings → General).
4. Create. Copy the **Client ID** and **Client secret**.

- [ ] **Step 3: Supabase dashboard — enable Google**

1. Authentication → Providers → Google → toggle **Enabled**.
2. Paste Client ID and Client secret. Save.
3. Authentication → URL Configuration:
   - Site URL: `https://thissongfits.com`
   - Redirect URLs (add each, no wildcards across hosts): `http://localhost:3000/**`, `https://thissongfits.com/**`. Task 1.7 adds the exact Vercel URL. For phone testing on the LAN add `http://<LAN-IP>:3000/**` and remove it after.
4. Save.

- [ ] **Step 4: Local env**

In `.env.local` confirm `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` point at this project.

- [ ] **Step 5: Manual verify**

1. `pnpm dev`, open `http://localhost:3000`, tap "Continue with Google".
2. Expected: Google account chooser → consent → redirected to `http://localhost:3000/` showing the upload form.
3. Supabase → Authentication → Users shows your Gmail. Table `creators` has a matching row and `events` has one `signed_up` row for it.

---

### Task 1.7: Deploy to Vercel and run the phone test (ruling C7)

**Files:**
- Create: `app/api/health/route.ts`
- Modify: `README.md` (Deploy section: the steps below)

**Interfaces:**
- Produces: a public Vercel URL running this branch, a verified 300 s function budget, and a submission created from an iPhone over cellular.

- [ ] **Step 1: Write the health route that proves the function budget**

```ts
// app/api/health/route.ts
import { NextResponse } from "next/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** GET /api/health?sleep=65 → waits that many seconds then returns 200. Proves maxDuration is honoured. */
export async function GET(request: Request) {
  const sleep = Math.min(Number(new URL(request.url).searchParams.get("sleep") ?? "0"), 290);
  if (sleep > 0) await new Promise((r) => setTimeout(r, sleep * 1000));
  return NextResponse.json({ ok: true, slept: sleep });
}
```

Run locally: `curl -s "http://localhost:3000/api/health?sleep=2"` → `{"ok":true,"slept":2}`.

- [ ] **Step 2: Push the repo to GitHub**

```bash
gh auth status || gh auth login
gh repo create songfit --private --source=. --remote=origin --push
```

Expected: `origin` set, branch `mvp` pushed.

- [ ] **Step 3: Create the Vercel project (Dylan signs in; Claude runs the commands)**

```bash
pnpm dlx vercel login
pnpm dlx vercel link        # new project "songfit", framework Next.js, root "./"
```

In the Vercel dashboard → Project → Settings:
- **Functions → Fluid Compute: ON** (required for 300 s on Hobby; Pro gives it by default). Codex's note stands: a commercial subscription app should be on Pro; Dylan decides by Wednesday.
- **Environment Variables**: every key in `.env.example` with the production values (Supabase URL/anon/service role, Anthropic, OpenAI, `ADMIN_EMAILS`, `INTERNAL_TOKEN` = `openssl rand -hex 32`, `NEXT_PUBLIC_SITE_URL` = the Vercel URL for now). Stripe keys are added in Phase 4.
- **Git**: production branch `mvp` for now (switch to `main` when merging).

```bash
pnpm dlx vercel --prod
```

Expected: a URL like `https://songfit-<hash>.vercel.app` (note the stable project URL `https://songfit.vercel.app` if the name is free).

- [ ] **Step 4: Prove the budget on Vercel**

Run: `curl -s -m 120 "https://<vercel-url>/api/health?sleep=65"`
Expected: `{"ok":true,"slept":65}` after ~65 s. A 504 or an empty response before 60 s means Fluid Compute is off or the plan caps functions at 60 s; fix that before continuing.

- [ ] **Step 5: Point Supabase and Google at the Vercel URL**

1. Supabase → Authentication → URL Configuration → Redirect URLs: add `https://<vercel-url>/**` (exact host).
2. Google Cloud → the OAuth client → Authorized JavaScript origins: add `https://<vercel-url>`.

- [ ] **Step 6: Phone test on cellular**

On an iPhone with Wi-Fi OFF:
1. Open `https://<vercel-url>` in Safari. Tap "Continue with Google" → sign in → upload form appears.
2. Pick a 60 s MOV shot on the phone (HEVC, 1080p; typically 60–120 MB). Tap "Find my songs".
3. Expected: progress climbs in steps, then the waiting page with rotating lines.
4. Supabase Studio: `submissions` has the row with `status = analyzing`, `video_path = <creatorId>/<uuid>.mov`; `events` has `submission_created` and `upload_completed`; Storage → `videos` has the object with the right size.
5. Vercel → Logs: `pipeline.start` for that id, no errors.

If the upload fails above 50 MB with a Storage error about file size, the Supabase project is on the Free plan (50 MB object limit). Either upgrade to Pro (Dylan's decision, ruling C7) or lower `LIMITS.maxUploadBytes` to `50 * 1024 * 1024` and the copy to "under 50 MB" until then.

- [ ] **Step 7: Commit**

```bash
git add app/api/health README.md
git commit -m "Add health route and Vercel deploy steps; phone upload verified on cellular"
git push
```

---

### Phase 1 demo check

- [ ] `pnpm typecheck && pnpm test && pnpm build` all exit 0 (the end-of-phase gate).
- [ ] Task 1.7 Step 6 passed on a real iPhone over cellular against the Vercel URL, including a > 50 MB file (or the 50 MB cap was consciously set).
- [ ] Signed out, the landing shows only the Google button; `GET /api/submissions/<id>` for someone else's id returns 404; a sixth `/api/upload-url` within a minute returns 429.
- [ ] A second creator account that already has one `ready` row (set it by hand in Studio) gets 402 from `/api/upload-url` and lands on `/subscribe` (page exists in Phase 4; a 404 there is fine for now, the redirect is what's being checked).
- [ ] Commit any fixes found during the demo:

```bash
git add -A
git commit -m "Phase 1: upload to stored submission working from a phone on the deployed app"
```
