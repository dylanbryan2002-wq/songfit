## Phase 1 — Upload → stored submission

**Demo when done:** From a phone on the LAN, sign in with Google, pick a Reel, watch it upload with a progress bar, land on a waiting page that polls a real `submissions` row.

Assumes Phase 0 is complete: scaffold, `src/shared/{types,config,logger,errors}.ts`, `src/db/client.ts` (`createBrowserClient`, `createServerClient`, `createServiceClient`), `src/db/queries/*`, `src/feedback/events.ts` (`EVENT_NAMES`, `logEvent`), `components/Logo.tsx`, `app/page.tsx` rendering a placeholder `<UploadForm />`.

Query functions from Phase 0 used here (signatures):

```ts
// src/db/queries/creators.ts
export async function ensureCreator(id: string, email: string, displayName?: string | null): Promise<CreatorRow>; // CreatorRow has created_at
// src/db/queries/submissions.ts
export async function getSubmission(id: string): Promise<SubmissionRow | null>;
export async function createSubmission(s: { id: string; creatorId: string; videoPath: string; creatorIntent: string | null }): Promise<SubmissionRow>;
export async function setSubmissionStatus(id: string, status: SubmissionStatus, error?: string | null): Promise<void>;
export async function countReadySubmissions(creatorId: string): Promise<number>;
// src/db/queries/subscriptions.ts
export async function getActiveSubscription(creatorId: string): Promise<{ id: string; status: string } | null>;
```

`SubmissionRow` is `Database["public"]["Tables"]["submissions"]["Row"]` from `src/db/types.ts`.

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
- Consumes: `createServerClient()` from `src/db/client.ts` (returns a Supabase client bound to Next cookies), `env()` from `src/shared/config.ts`, `ensureCreator()` from `src/db/queries/creators.ts`.
- Produces:
  - `isAdminEmail(email: string | null | undefined, list: string): boolean` (pure)
  - `getCreator(): Promise<{ id: string; email: string } | null>`
  - `requireCreator(): Promise<{ id: string; email: string }>` — redirects to `/` when signed out
  - `requireAdmin(): Promise<{ id: string; email: string }>` — redirects to `/` unless admin
  - `signInWithGoogle(next: string): Promise<void>` (client)

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

export async function requireAdmin(): Promise<Creator> {
  const creator = await getCreator();
  if (!creator || !isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "")) {
    redirect("/");
  }
  return creator;
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 8: Write the client sign-in helper**

```ts
// components/auth.ts
"use client";
import { createBrowserClient } from "@/src/db/client";

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

### Task 1.2: Signed upload URL, storage helpers, paywall decision

**Files:**
- Create: `src/media/storage.ts`
- Create: `src/billing/paywall.ts`
- Create: `app/api/upload-url/route.ts`
- Test: `tests/billing/paywall.test.ts`

**Interfaces:**
- Consumes: `createServiceClient()` from `src/db/client.ts`, `LIMITS` and `env()` from `src/shared/config.ts`, `getCreator()` from `src/auth/session.ts`, `countReadySubmissions()` from `src/db/queries/submissions.ts` and `getActiveSubscription()` from `src/db/queries/subscriptions.ts` (both defined in Phase 0, Task 0.4).
- Note for `storage.ts`: import `{ mkdtemp, writeFile }` from `node:fs/promises`, `os` from `node:os`, `path` from `node:path`. No shared `TMP_DIR` constant is needed.
- Produces:
  - `getSignedUploadUrl(creatorId, submissionId, ext): Promise<{ path; token; signedUrl }>`
  - `downloadToTmp(storagePath): Promise<string>` (local file path)
  - `getSignedPlaybackUrl(storagePath, seconds = 3600): Promise<string>`
  - `decideCanSubmit(readyCount: number, hasActiveSub: boolean): { ok: true } | { ok: false; reason: "needs_subscription" }` (pure)
  - `canSubmit(creatorId): Promise<ReturnType<typeof decideCanSubmit>>`
  - `POST /api/upload-url` → `200 { submissionId, path, token, signedUrl }` | `401` | `402 { reason: "needs_subscription" }` | `400`

- [ ] **Step 1: Write the failing paywall test**

```ts
// tests/billing/paywall.test.ts
import { describe, expect, it } from "vitest";
import { decideCanSubmit } from "../../src/billing/paywall";

describe("decideCanSubmit", () => {
  it("allows the first submission with no subscription", () => {
    expect(decideCanSubmit(0, false)).toEqual({ ok: true });
  });
  it("blocks a second submission without an active subscription", () => {
    expect(decideCanSubmit(1, false)).toEqual({ ok: false, reason: "needs_subscription" });
    expect(decideCanSubmit(5, false)).toEqual({ ok: false, reason: "needs_subscription" });
  });
  it("allows any submission with an active subscription", () => {
    expect(decideCanSubmit(0, true)).toEqual({ ok: true });
    expect(decideCanSubmit(9, true)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/billing/paywall.test.ts`
Expected: FAIL — `Cannot find module '../../src/billing/paywall'`

- [ ] **Step 3: Write the paywall module**

```ts
// src/billing/paywall.ts
import { countReadySubmissions } from "@/src/db/queries/submissions";
import { getActiveSubscription } from "@/src/db/queries/subscriptions";

export type CanSubmit = { ok: true } | { ok: false; reason: "needs_subscription" };

/** Pure rule: one free result per creator; after that an active subscription is required. */
export function decideCanSubmit(readyCount: number, hasActiveSub: boolean): CanSubmit {
  if (hasActiveSub) return { ok: true };
  if (readyCount >= 1) return { ok: false, reason: "needs_subscription" };
  return { ok: true };
}

export async function canSubmit(creatorId: string): Promise<CanSubmit> {
  const [readyCount, sub] = await Promise.all([
    countReadySubmissions(creatorId),
    getActiveSubscription(creatorId),
  ]);
  return decideCanSubmit(readyCount, sub !== null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/billing/paywall.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the storage helpers**

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

export async function objectExists(storagePath: string): Promise<boolean> {
  const supabase = createServiceClient();
  const dir = path.posix.dirname(storagePath);
  const name = path.posix.basename(storagePath);
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).list(dir, { search: name });
  if (error) throw new Error(`storage list failed: ${error.message}`);
  return (data ?? []).some((o) => o.name === name);
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

- [ ] **Step 6: Write the upload-url route**

```ts
// app/api/upload-url/route.ts
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { canSubmit } from "@/src/billing/paywall";
import { getSignedUploadUrl } from "@/src/media/storage";
import { LIMITS } from "@/src/shared/config";

const Body = z.object({
  ext: z.enum(["mp4", "mov", "webm", "m4v"]),
  sizeBytes: z.number().int().positive().max(LIMITS.maxUploadBytes),
});

export async function POST(request: Request) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const gate = await canSubmit(creator.id);
  if (!gate.ok) return NextResponse.json({ reason: gate.reason }, { status: 402 });

  const submissionId = randomUUID();
  const { path, token, signedUrl } = await getSignedUploadUrl(creator.id, submissionId, parsed.data.ext);
  return NextResponse.json({ submissionId, path, token, signedUrl });
}
```

- [ ] **Step 7: Typecheck and run all tests**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck exits 0; vitest PASS including `tests/billing/paywall.test.ts`

- [ ] **Step 8: Manual check with curl (signed-in cookie required, so use the browser instead)**

In a browser signed in on `http://localhost:3000`, open devtools console and run:

```js
await fetch("/api/upload-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ext: "mp4", sizeBytes: 1000 }) }).then(r => r.json())
```

Expected: `{ submissionId: "<uuid>", path: "<creatorId>/<uuid>.mp4", token: "...", signedUrl: "https://..." }`. Signed out, expected `401`.

- [ ] **Step 9: Commit**

```bash
git add src/media/storage.ts src/billing/paywall.ts app/api/upload-url tests/billing
git commit -m "Add signed upload URL route, storage helpers and paywall rule"
```

---

### Task 1.3: Submission creation, pipeline trigger, status endpoint

**Files:**
- Create: `src/pipeline/run.ts` (stub for this phase)
- Create: `app/api/submissions/route.ts`
- Create: `app/api/submissions/[id]/run/route.ts`
- Create: `app/api/submissions/[id]/route.ts`
- Modify: `.env.example` (add `INTERNAL_TOKEN`)

**Interfaces:**
- Consumes: `getCreator()`, `isAdminEmail()`, `objectExists()`, `createSubmission()`, `getSubmission()`, `setSubmissionStatus()`, `logEvent()`, `env()`.
- Produces:
  - `runSubmission(submissionId: string): Promise<void>` — Phase 2 replaces the body; signature is final.
  - `POST /api/submissions` body `{ submissionId, path, creatorIntent }` → `201 { id }`
  - `POST /api/submissions/[id]/run` header `x-internal-token` → `200 { ok: true }`
  - `GET /api/submissions/[id]` → `200 { status, error, recommendations: [] }` | `404`

- [ ] **Step 1: Add `INTERNAL_TOKEN` to `.env.example`**

Append:

```
# Shared secret so only this app can trigger pipeline runs. Generate: openssl rand -hex 32
INTERNAL_TOKEN=
```

Also add a real random value to your local `.env.local`.

- [ ] **Step 2: Write the pipeline stub**

```ts
// src/pipeline/run.ts
import { setSubmissionStatus } from "@/src/db/queries/submissions";
import { logger } from "@/src/shared/logger";

/**
 * Runs the full pipeline for a submission. Phase 1 stub: only advances the
 * status so the waiting page has something to poll. Phase 2 adds analysis,
 * Phase 3 adds recommendation.
 */
export async function runSubmission(submissionId: string): Promise<void> {
  logger.info("pipeline.start", { submissionId });
  await setSubmissionStatus(submissionId, "analyzing");
}
```

- [ ] **Step 3: Write the submission creation route**

```ts
// app/api/submissions/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { createSubmission, countSubmissionsForCreator } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";
import { objectExists } from "@/src/media/storage";
import { env } from "@/src/shared/config";
import { logger } from "@/src/shared/logger";

const Body = z.object({
  submissionId: z.string().uuid(),
  path: z.string().min(1),
  creatorIntent: z.string().trim().max(300).nullable().optional(),
});

export async function POST(request: Request) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { submissionId, path, creatorIntent } = parsed.data;

  // The path must belong to this creator and the object must really exist.
  if (!path.startsWith(`${creator.id}/`)) {
    return NextResponse.json({ error: "forbidden_path" }, { status: 403 });
  }
  if (!(await objectExists(path))) {
    return NextResponse.json({ error: "upload_not_found" }, { status: 400 });
  }

  const submission = await createSubmission({
    id: submissionId,
    creatorId: creator.id,
    videoPath: path,
    creatorIntent: creatorIntent?.length ? creatorIntent : null,
  });

  await logEvent({ name: "submission_created", creatorId: creator.id, submissionId: submission.id });
  await logEvent({ name: "upload_completed", creatorId: creator.id, submissionId: submission.id });
  if ((await countSubmissionsForCreator(creator.id)) >= 2) {
    await logEvent({ name: "returned_with_second_submission", creatorId: creator.id, submissionId: submission.id });
  }

  // Fire the pipeline without awaiting it. On Vercel the function may be
  // frozen once we return; `waitUntil` keeps the fetch alive. Locally it
  // simply runs in the background.
  const origin = new URL(request.url).origin;
  const trigger = fetch(`${origin}/api/submissions/${submission.id}/run`, {
    method: "POST",
    headers: { "x-internal-token": env("INTERNAL_TOKEN") },
  }).catch((err) => logger.error("pipeline.trigger_failed", { submissionId, err: String(err) }));

  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(trigger);
  } catch {
    // @vercel/functions not available (local dev without the package): fire and forget.
    void trigger;
  }

  return NextResponse.json({ id: submission.id }, { status: 201 });
}
```

Install the helper so the import resolves on Vercel: `pnpm add @vercel/functions`.

Risk note (document in README under "Known limitations"): if `@vercel/functions` is unavailable and the serverless function is frozen before the trigger request leaves, the pipeline never starts. The admin queue (Phase 4) has a Retry button that calls the run route directly, which covers this case.

- [ ] **Step 4: Write the run route**

```ts
// app/api/submissions/[id]/run/route.ts
import { NextResponse } from "next/server";
import { runSubmission } from "@/src/pipeline/run";
import { env } from "@/src/shared/config";
import { logger } from "@/src/shared/logger";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = request.headers.get("x-internal-token");
  if (!token || token !== env("INTERNAL_TOKEN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    await runSubmission(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("pipeline.unhandled", { submissionId: id, err: String(err) });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 5: Write the status route**

```ts
// app/api/submissions/[id]/route.ts
import { NextResponse } from "next/server";
import { isAdminEmail } from "@/src/auth/admin";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await ctx.params;
  const submission = await getSubmission(id);
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const isOwner = submission.creator_id === creator.id;
  const isAdmin = isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "");
  if (!isOwner && !isAdmin) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    status: submission.status,
    error: submission.error,
    recommendations: [], // Phase 3 fills this from the recommendations table
  });
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0

- [ ] **Step 7: Manual check of the run route token guard**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/submissions/00000000-0000-0000-0000-000000000000/run`
Expected: `403`

Run: `curl -s -X POST -H "x-internal-token: $(grep INTERNAL_TOKEN .env.local | cut -d= -f2)" http://localhost:3000/api/submissions/00000000-0000-0000-0000-000000000000/run`
Expected: `{"ok":false,"error":"..."}` with a 500 (no such row) — proves the guard passed and `runSubmission` was called.

- [ ] **Step 8: Commit**

```bash
git add src/pipeline/run.ts app/api/submissions .env.example package.json pnpm-lock.yaml
git commit -m "Add submission creation, pipeline trigger and status routes"
```

---

### Task 1.4: UploadForm — pick video, sign in, upload with progress, create submission

**Files:**
- Create: `components/UploadForm.tsx`
- Create: `components/videoDuration.ts`
- Create: `components/uploadWithProgress.ts`
- Modify: `app/page.tsx`
- Test: `tests/components/fileExt.test.ts`

**Interfaces:**
- Consumes: `signInWithGoogle()` from `components/auth.ts`, `createBrowserClient()` from `src/db/client.ts`, `LIMITS` from `src/shared/config.ts`, `POST /api/upload-url`, `POST /api/submissions`.
- Produces:
  - `fileExt(file: { name: string; type: string }): "mp4" | "mov" | "webm" | "m4v" | null` (pure)
  - `readVideoDuration(file: File): Promise<number>` (client)
  - `uploadWithProgress(signedUrl: string, file: File, onProgress: (pct: number) => void): Promise<void>` (client, XHR PUT)
  - `<UploadForm creator={Creator | null} resume={boolean} />`

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

- [ ] **Step 6: Write the XHR uploader with progress**

Supabase's `uploadToSignedUrl` does not expose progress in the browser, so PUT directly to the signed URL. The signed upload URL from `createSignedUploadUrl` accepts a PUT with the file body and the token in the `Authorization` header is not required because the token is embedded in the URL query (`?token=...`).

```ts
// components/uploadWithProgress.ts
"use client";

export function uploadWithProgress(
  signedUrl: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
}
```

Fallback: if the PUT returns 400 in testing, switch to the SDK call (no progress):

```ts
const supabase = createBrowserClient();
const { error } = await supabase.storage.from("videos").uploadToSignedUrl(path, token, file, { contentType: file.type });
if (error) throw error;
```

- [ ] **Step 7: Write the UploadForm component**

```tsx
// components/UploadForm.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithGoogle } from "./auth";
import { fileExt } from "./fileExt";
import { readVideoDuration } from "./videoDuration";
import { uploadWithProgress } from "./uploadWithProgress";
import { LIMITS } from "@/src/shared/config";

type Creator = { id: string; email: string } | null;
type Phase = "idle" | "checking" | "uploading" | "creating" | "error";

const PENDING_KEY = "songfit.pending";

export function UploadForm({ creator, resume }: { creator: Creator; resume: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [intent, setIntent] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Restore intent after the OAuth round-trip. The File cannot survive a redirect.
  useEffect(() => {
    if (!resume) return;
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (raw) {
        const pending = JSON.parse(raw) as { intent?: string };
        if (pending.intent) setIntent(pending.intent);
        sessionStorage.removeItem(PENDING_KEY);
      }
    } catch {
      /* sessionStorage unavailable: nothing to restore */
    }
  }, [resume]);

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
    const f = e.target.files?.[0] ?? null;
    setError(null);
    setFile(f);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!creator) {
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ intent }));
      } catch {
        /* ignore */
      }
      await signInWithGoogle("/?resume=1");
      return;
    }

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
      if (!urlRes.ok) throw new Error("Couldn't start the upload. Try again.");
      const { submissionId, path, signedUrl } = (await urlRes.json()) as {
        submissionId: string;
        path: string;
        token: string;
        signedUrl: string;
      };

      setPhase("uploading");
      setProgress(0);
      await uploadWithProgress(signedUrl, file, setProgress);

      setPhase("creating");
      const createRes = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId, path, creatorIntent: intent.trim() || null }),
      });
      if (!createRes.ok) throw new Error("Upload finished but we couldn't save it. Try again.");
      const { id } = (await createRes.json()) as { id: string };
      router.push(`/results/${id}`);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
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
            <span className="text-lg font-semibold text-neutral-900">
              {resume && !file ? "Pick your video again to continue" : "Tap to add your Reel"}
            </span>
            <span className="text-sm text-neutral-500">MP4 or MOV, up to 3 minutes</span>
          </div>
        )}
        <input
          id="video"
          ref={inputRef}
          type="file"
          accept="video/*"
          className="sr-only"
          onChange={onPick}
          disabled={busy}
        />
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
        {(phase === "idle" || phase === "error") && (creator ? "Find my songs" : "Find my songs")}
      </button>
    </form>
  );
}
```

- [ ] **Step 8: Wire the page**

```tsx
// app/page.tsx
import { getCreator } from "@/src/auth/session";
import { Logo } from "@/components/Logo";
import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string }>;
}) {
  const [creator, params] = await Promise.all([getCreator(), searchParams]);
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
      <UploadForm creator={creator} resume={params.resume === "1"} />
    </main>
  );
}
```

- [ ] **Step 9: Typecheck and run tests**

Run: `pnpm typecheck && pnpm test`
Expected: exits 0; PASS including `tests/components/fileExt.test.ts`

- [ ] **Step 10: Manual check in the browser**

1. `pnpm dev`, open `http://localhost:3000` signed out. Type an intent, tap "Find my songs". Expected: Google sign-in; on return the URL is `/?resume=1`, the intent is restored, the tap target says "Pick your video again to continue".
2. Pick a short MP4, tap "Find my songs". Expected: button shows "Uploading NN%", then navigates to `/results/<uuid>`.
3. In Supabase Studio, Storage → `videos` → `<creatorId>/<uuid>.mp4` exists; `submissions` has one row with `status = analyzing`.

- [ ] **Step 11: Commit**

```bash
git add components/UploadForm.tsx components/fileExt.ts components/videoDuration.ts components/uploadWithProgress.ts app/page.tsx tests/components
git commit -m "Add upload form with Google sign-in, progress and submission creation"
```

---

### Task 1.5: Waiting page with status polling

**Files:**
- Create: `app/results/[id]/page.tsx`
- Create: `components/WaitingState.tsx`

**Interfaces:**
- Consumes: `getCreator()`, `isAdminEmail()`, `getSubmission()`, `GET /api/submissions/[id]`.
- Produces: `<WaitingState id={string} />`; `/results/[id]` renders waiting state until `status === "ready"`, then a placeholder (Phase 3 replaces the placeholder with the results list).

- [ ] **Step 1: Write the WaitingState client component**

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

export function WaitingState({ id }: { id: string }) {
  const router = useRouter();
  const [lineIdx, setLineIdx] = useState(0);
  const [slow, setSlow] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const t = setInterval(() => setLineIdx((i) => (i + 1) % LINES.length), LINE_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(`/api/submissions/${id}`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { status: Status };
          if (body.status === "ready" && !cancelled) {
            router.refresh();
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
  }, [id, router]);

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
      <style jsx global>{`
        @keyframes slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
```

If `styled-jsx` is not enabled in the scaffold, move the keyframes into `app/globals.css`:

```css
@keyframes slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
```

and delete the `<style jsx global>` block.

- [ ] **Step 2: Write the results page (waiting branch now, results branch in Phase 3)**

```tsx
// app/results/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { isAdminEmail } from "@/src/auth/admin";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { Logo } from "@/components/Logo";
import { WaitingState } from "@/components/WaitingState";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, creator] = await Promise.all([params, getCreator()]);
  if (!creator) redirect(`/?next=${encodeURIComponent(`/results/${id}`)}`);

  const submission = await getSubmission(id);
  if (!submission) notFound();
  const isOwner = submission.creator_id === creator.id;
  const isAdmin = isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "");
  if (!isOwner && !isAdmin) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-10 px-4 pb-10 pt-10">
      <Logo />
      {submission.status === "ready" ? (
        // Phase 3 replaces this block with the recommendation cards.
        <h1 className="text-2xl font-semibold text-neutral-900">Ready</h1>
      ) : (
        <WaitingState id={id} />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0

- [ ] **Step 4: Manual check**

1. Upload a video (Task 1.4). Expected: `/results/<id>` shows the sliding bar and the rotating lines, changing every 4 s.
2. In Supabase Studio, set that row's `status` to `ready`. Expected: within 3 s the page shows "Ready".
3. Network tab: a `GET /api/submissions/<id>` every 3 s, `200`.
4. Open the same URL in a private window signed in as a different Google account. Expected: 404.

- [ ] **Step 5: Commit**

```bash
git add app/results components/WaitingState.tsx app/globals.css
git commit -m "Add waiting page that polls submission status"
```

---

### Task 1.6: Google provider setup (Dylan, no code)

**Files:** none. Supabase dashboard + Google Cloud Console.

**Interfaces:**
- Produces: a working Google provider on the Supabase project, with redirect URLs for local and production.

- [ ] **Step 1: Google Cloud Console — OAuth consent screen**

1. Go to `https://console.cloud.google.com/`, create or select a project named `Songfit`.
2. APIs & Services → OAuth consent screen → User type **External** → Create.
3. App name `Songfit`, user support email = your Gmail, developer contact = your Gmail. Save.
4. Scopes → Add → tick `.../auth/userinfo.email` and `.../auth/userinfo.profile` → Update → Save.
5. Publishing status: click **Publish app** so any Google account can sign in (otherwise only listed test users can).

- [ ] **Step 2: Google Cloud Console — OAuth client**

1. APIs & Services → Credentials → Create credentials → **OAuth client ID** → Application type **Web application**, name `Songfit web`.
2. Authorized JavaScript origins: `http://localhost:3000`, `https://thissongfits.com`.
3. Authorized redirect URIs:
   - `https://<project-ref>.supabase.co/auth/v1/callback` (project ref from Supabase → Settings → General)
   - `http://127.0.0.1:54321/auth/v1/callback` (local Supabase, only if using `supabase start`)
4. Create. Copy the **Client ID** and **Client secret**.

- [ ] **Step 3: Supabase dashboard — enable Google**

1. Authentication → Providers → Google → toggle **Enabled**.
2. Paste Client ID and Client secret. Save.
3. Authentication → URL Configuration:
   - Site URL: `https://thissongfits.com`
   - Redirect URLs (add each): `http://localhost:3000/auth/callback`, `http://localhost:3000/**`, `https://thissongfits.com/auth/callback`, `https://*.vercel.app/auth/callback`
4. Save.

- [ ] **Step 4: Local env**

In `.env.local` confirm `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` point at this project (or the local stack if using `supabase start`, in which case also enable Google in `supabase/config.toml` under `[auth.external.google]` with `enabled = true`, `client_id`, `secret` via env).

- [ ] **Step 5: Manual verify**

1. `pnpm dev`, open `http://localhost:3000`, tap "Find my songs".
2. Expected: Google account chooser → consent → redirected to `http://localhost:3000/?resume=1`.
3. Supabase → Authentication → Users shows your Gmail. Table `creators` has a matching row (created by `getCreator()` on the first server render after login).

---

### Phase 1 demo check

- [ ] **Step 1: Find your Mac's LAN IP and start dev on all interfaces**

Run: `ipconfig getifaddr en0` → e.g. `192.168.1.23`
Run: `pnpm dev -H 0.0.0.0`

Add `http://192.168.1.23:3000/auth/callback` to Supabase → Authentication → URL Configuration → Redirect URLs, and `http://192.168.1.23:3000` to the Google OAuth client's authorized JavaScript origins (Google rejects private IPs as redirect URIs, but the redirect goes to Supabase, not to the app, so only the origin matters).

- [ ] **Step 2: From a phone on the same Wi-Fi**

1. Open `http://192.168.1.23:3000` in Safari or Chrome.
2. Tap "Find my songs" → Google sign-in → back on the page with "Pick your video again to continue".
3. Tap the big target → camera roll → pick a ~20 s video. Tap "Find my songs".
4. Expected: progress climbs to 100%, then the waiting page with rotating lines.

- [ ] **Step 3: Confirm the data**

In Supabase Studio → Table editor:
- `submissions`: one row, `status = analyzing`, `video_path = <creatorId>/<uuid>.mov` (iPhone) or `.mp4`, `creator_intent` matches what you typed or is null.
- `events`: two rows for that `submission_id`: `submission_created` and `upload_completed`.
- Storage → `videos`: the object exists and plays via a signed URL.

If the status stays `uploaded`, the trigger fetch didn't reach the run route: check the dev server log for `pipeline.trigger_failed` and verify `INTERNAL_TOKEN` is set in `.env.local`.

- [ ] **Step 4: Commit any fixes found during the demo**

```bash
git add -A
git commit -m "Phase 1: upload to stored submission working on mobile"
```
