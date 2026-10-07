## Phase 0 — Foundations

**Demo when done:** `pnpm dev` serves the upload screen shell with the headline; the hosted Supabase project has every table, function and bucket from `docs/DATA_MODEL.md`; `pnpm db:types` produces `src/db/types.ts`; `pnpm typecheck && pnpm test && pnpm build` pass; `pnpm smoke` reports OK for Claude, Whisper, Deezer and the database.

Notes for the implementer:
- This phase was revised after the Codex review (`docs/review/02-codex-review.md`, rulings in `docs/review/03-claude-rulings.md`). Where this file and the plan header's Global Constraints disagree, the constraints win.
- There is no Docker, Homebrew or system Supabase CLI on this Mac. Supabase is **hosted**: migrations are pushed with `supabase db push` and types are generated with `--project-id`. The `supabase` CLI is installed as a dev dependency so `pnpm` scripts can call it.
- `candidates` and `recommendations` carry more columns than the original `docs/DATA_MODEL.md` because the engine types require them (anchor, vocal flag, directions, canonical provider strings, provenance, feedback flags). Task 0.3 step 1 updates the doc first, per CLAUDE.md.
- `src/db/client.ts` imports `next/headers`, so the browser client lives in its own file `src/db/browser.ts`. Client components import only from `src/db/browser.ts`.
- All `src/db/queries/*` functions use the service-role client and are `server-only`. Ownership checks (is this the caller's submission?) happen in the route/page that calls them. RLS still protects any direct Supabase access from the browser.
- The paywall is enforced **in the database** by the `create_submission()` function, and pipeline runs are claimed atomically by `claim_submission_run()`. Routes never implement either rule themselves.

---

### Task 0.1: Scaffold the Next.js app

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json`
- Modify (both already exist and are committed): `.gitignore`, `.env.example`
- Create (temporary, replaced in Task 0.6): `app/layout.tsx`, `app/page.tsx`, `app/globals.css`

**Interfaces:**
- Produces: the `@/*` path alias mapping to the repo root (so `@/src/shared/types` resolves), the scripts every later task runs (`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:types`, `pnpm db:push`, `pnpm smoke`), pinned dependency versions, and `serverExternalPackages` for the ffmpeg binaries (Task 4.7 must preserve it).

- [ ] **Step 1: Scaffold with create-next-app via a temp dir**

`README.md`, `CLAUDE.md`, `docs/`, `.gitignore` and `.env.example` already exist, so scaffold into a temp dir and copy back everything except the files we already own. `CI=1` stops create-next-app prompting.

```bash
CI=1 pnpm create next-app@15 /tmp/songfit-scaffold --ts --eslint --app --no-src-dir --no-tailwind --import-alias "@/*" --use-pnpm --yes
rsync -a --exclude README.md --exclude .git --exclude .gitignore /tmp/songfit-scaffold/ /Users/dylanbryan/Songfit/
rm -rf /tmp/songfit-scaffold
```

Expected: the folder now contains `app/`, `public/`, `next.config.ts`, `tsconfig.json`, `package.json`, `.eslintrc.json` (or `eslint.config.mjs`), `next-env.d.ts`. `README.md`, `.gitignore` and `.env.example` are unchanged.

- [ ] **Step 2: Install pinned runtime and dev dependencies**

```bash
pnpm add next@15 react@19 react-dom@19 @supabase/supabase-js@2 @supabase/ssr@0.5 @anthropic-ai/sdk@0.52 openai@4 zod@3 ffmpeg-static@5 ffprobe-static@3 stripe@17 p-limit@6 @vercel/functions@1 server-only@0.0.1
pnpm add -D typescript@5 vitest@2 tsx@4 supabase@2 @types/node@22 @types/react@19 @types/react-dom@19 tailwindcss@3 postcss@8 autoprefixer@10 eslint@9 eslint-config-next@15
```

Expected: `pnpm-lock.yaml` updated, no peer-dependency errors. `ffmpeg-static` and `ffprobe-static` download binaries on install (~70 MB); if a download fails, re-run `pnpm install`. `supabase` installs the CLI binary so `pnpm supabase --version` works. If any exact major above is unavailable, use the newest release of that major and note it in the report; never use an unpinned `latest`.

- [ ] **Step 3: Replace `package.json` scripts**

Edit `package.json` so the `scripts` block is exactly:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:push": "supabase db push",
    "db:types": "supabase gen types typescript --project-id $SUPABASE_PROJECT_REF --schema public > src/db/types.ts",
    "smoke": "node --env-file=.env.local --import tsx scripts/smoke.ts"
  }
}
```

`db:types` reads `SUPABASE_PROJECT_REF` from the shell. Before running it: `set -a; source .env.local; set +a`.

- [ ] **Step 4: Write `tsconfig.json`**

Overwrite with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "supabase/functions"]
}
```

- [ ] **Step 5: Write Tailwind v3 config and PostCSS config**

`tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0F1419",
        steel: { light: "#8FA8C8", DEFAULT: "#5B7190", dark: "#2E3A4A" },
        canvas: "#F7F8FA",
        muted: "#6B7280",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Inter", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
```

`postcss.config.mjs`:

```js
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
```

- [ ] **Step 6: Write `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static / ffprobe-static ship native binaries; they must not be bundled.
  // Task 4.7 edits this file and MUST keep this line.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
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

- [ ] **Step 7: Merge missing keys into `.env.example`**

`.env.example` already exists with Supabase, AI, Stripe and app keys. Do not replace it. Add only the keys below that are missing, each under the matching section:

```bash
# --- Supabase (Project Settings → General / Database) ---
SUPABASE_PROJECT_REF=your-project-ref
SUPABASE_DB_PASSWORD=the-database-password-you-set-when-creating-the-project

# --- Stripe (Wednesday) ---
STRIPE_PRICE_ID=price_...
```

Then verify the final file lists exactly these keys: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PAYMENT_LINK_URL`, `STRIPE_PRICE_ID`, `ADMIN_EMAILS`, `INTERNAL_TOKEN`, `NEXT_PUBLIC_SITE_URL`.

```bash
grep -oE '^[A-Z_]+=' .env.example | sort
```

Expected: 14 lines. Never read, print or edit `.env.local`.

- [ ] **Step 8: Merge `.gitignore`**

`.gitignore` already ignores `node_modules/`, `.next/`, `.env*`, `.superpowers/` and more. Append only what is missing:

```
# supabase local state
supabase/.branches
supabase/.temp

# media scratch
tmp/
```

Keep every existing line (`.env.local`, `.env*.local`, `.superpowers/` in particular).

- [ ] **Step 9: Verify typecheck and build run**

```bash
pnpm typecheck
pnpm build
```

Expected: `pnpm typecheck` exits 0 with no output. `pnpm build` prints the route table with `○ /` and exits 0, with no warning about `serverExternalPackages`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app with pinned deps, Tailwind, scripts and env template"
```

---

### Task 0.2: Shared config, types, errors, logger, JSON extraction, Claude caller

**Files:**
- Create: `src/shared/config.ts`, `src/shared/types.ts`, `src/shared/errors.ts`, `src/shared/logger.ts`, `src/shared/json.ts`, `src/shared/anthropic.ts`, `vitest.config.ts`
- Test: `tests/shared/types.test.ts`, `tests/shared/config.test.ts`, `tests/shared/json.test.ts`, `tests/shared/anthropic.test.ts`

**Interfaces:**
- Produces: everything in the "Shared interfaces" block of the header: `VideoAnalysis`, `MusicBrief`, `AnalysisResult`, `DirectionTag`, `DIRECTION_LABEL`, `GeneratedCandidate`, `VerifiedCandidate`, `DIMENSIONS`, `Dimension`, `ComponentScore`, `ComponentScores`, `ScoredCandidate`, `Pick`, `FinalRecommendation`, `RecommendationView`, `SubmissionStatus`; `MODELS`, `LIMITS`, `CONTENT_CATEGORIES`, `PREVIEWS_ENABLED`, `FREE_RESULTS_PER_CREATOR`, `env()`, `adminEmails()`, `siteUrl()`; `PipelineError`, `PaywallError`; `logger`; `extractJson(text): unknown`, `JsonExtractError`; `ClaudeCall`, `makeClaudeCall(client, opts?)`, `callClaude`.

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": process.cwd(),
      // The real package throws outside Next's server runtime.
      "server-only": path.join(process.cwd(), "tests", "stubs", "server-only.ts"),
    },
  },
});
```

Create `tests/stubs/server-only.ts`:

```ts
// Vitest stub: the real package throws outside Next's server runtime.
export {};
```

- [ ] **Step 2: Write the failing tests**

`tests/shared/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { VideoAnalysis, MusicBrief, GeneratedCandidate, RecommendationView, DIRECTION_LABEL } from "@/src/shared/types";

const validAnalysis = {
  summary: "Creator walks through NYC at night and reveals an outfit.",
  content_type: "fashion lifestyle reel",
  content_category: "fashion",
  setting: "New York at night",
  story: "walk then reveal",
  aesthetic: ["luxury", "urban"],
  mood: ["confident", "mysterious"],
  energy: "medium-high",
  pacing: "medium",
  dialogue_present: false,
  important_moments: [{ time: 7.8, type: "main_visual_reveal", note: "outfit reveal" }],
};

describe("VideoAnalysis schema", () => {
  it("accepts a valid analysis", () => {
    expect(VideoAnalysis.parse(validAnalysis)).toEqual(validAnalysis);
  });

  it("rejects an unknown energy value", () => {
    expect(() => VideoAnalysis.parse({ ...validAnalysis, energy: "extreme" })).toThrow();
  });

  it("rejects negative moment times", () => {
    expect(() =>
      VideoAnalysis.parse({ ...validAnalysis, important_moments: [{ time: -1, type: "x" }] }),
    ).toThrow();
  });
});

describe("MusicBrief schema", () => {
  it("rejects energy outside 0..1", () => {
    expect(() =>
      MusicBrief.parse({
        text: "brief",
        fields: {
          moods: ["cool"],
          energy: 1.4,
          tempo_preference: "medium-high",
          vocal_preference: "either",
          genre_preferences: [],
          genre_avoid: [],
          dialogue_present: false,
          desired_cultural_relevance: "high",
          desired_familiarity: "recognizable_not_overused",
        },
      }),
    ).toThrow();
  });
});

describe("GeneratedCandidate schema", () => {
  const valid = {
    title: "Blinding Lights",
    artist: "The Weeknd",
    proposed_start: 40,
    proposed_end: 55,
    anchor_seconds: 43,
    section_is_vocal: true,
    section_reason: "chorus enters at 0:43",
    fit_reason: "neon night-drive energy matches the city walk",
    directions: ["safe", "current"],
  };
  it("accepts a candidate with anchor, vocal flag and directions", () => {
    expect(GeneratedCandidate.parse(valid)).toEqual(valid);
  });
  it("rejects an empty directions list", () => {
    expect(() => GeneratedCandidate.parse({ ...valid, directions: [] })).toThrow();
  });
  it("rejects a missing anchor", () => {
    const { anchor_seconds: _omit, ...noAnchor } = valid;
    expect(() => GeneratedCandidate.parse(noAnchor)).toThrow();
  });
});

describe("RecommendationView schema", () => {
  it("has no score or reason fields", () => {
    const keys = Object.keys(RecommendationView.shape).sort();
    expect(keys).toEqual(
      [
        "artwork_url",
        "artist",
        "direction_label",
        "end_seconds",
        "explanation",
        "preview_url",
        "rank",
        "rejected",
        "selected",
        "spotify_url",
        "start_seconds",
        "title",
      ].sort(),
    );
  });
});

describe("DIRECTION_LABEL", () => {
  it("maps every direction to a creator-facing label", () => {
    expect(DIRECTION_LABEL).toEqual({
      safe: "Best fit",
      current: "More current",
      unexpected: "Unexpected",
    });
  });
});
```

`tests/shared/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env, LIMITS, MODELS, CONTENT_CATEGORIES, PREVIEWS_ENABLED, FREE_RESULTS_PER_CREATOR } from "@/src/shared/config";

describe("env()", () => {
  const KEY = "SONGFIT_TEST_ENV_VAR";
  beforeEach(() => {
    delete process.env[KEY];
  });
  afterEach(() => {
    delete process.env[KEY];
  });

  it("returns the value when set", () => {
    process.env[KEY] = "hello";
    expect(env(KEY)).toBe("hello");
  });

  it("throws a clear error when missing", () => {
    expect(() => env(KEY)).toThrow(/SONGFIT_TEST_ENV_VAR/);
  });

  it("throws when set to an empty string", () => {
    process.env[KEY] = "";
    expect(() => env(KEY)).toThrow();
  });
});

describe("LIMITS and MODELS", () => {
  it("keeps section bounds sane", () => {
    expect(LIMITS.sectionMin).toBeLessThan(LIMITS.sectionDefault);
    expect(LIMITS.sectionDefault).toBeLessThan(LIMITS.sectionMax);
    expect(LIMITS.maxDurationSeconds).toBe(180);
  });
  it("has 'other' as a content category", () => {
    expect(CONTENT_CATEGORIES).toContain("other");
  });
  it("uses Fable only for video analysis", () => {
    expect(MODELS.analysis).toBe("claude-fable-5-1");
    expect(MODELS.candidates).toBe("claude-sonnet-5-5");
    expect(MODELS.scoring).toBe("claude-sonnet-5-5");
    expect(MODELS.explain).toBe("claude-sonnet-5-5");
  });
  it("ships with previews off and one free result", () => {
    expect(PREVIEWS_ENABLED).toBe(false);
    expect(FREE_RESULTS_PER_CREATOR).toBe(1);
  });
});
```

`tests/shared/json.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractJson, JsonExtractError } from "@/src/shared/json";

describe("extractJson", () => {
  it("parses a bare object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a bare array", () => {
    expect(extractJson('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("strips a ```json fence", () => {
    expect(extractJson('```json\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  it("finds JSON wrapped in prose", () => {
    expect(extractJson('Sure! Here it is:\n{"ok":true}\nLet me know.')).toEqual({ ok: true });
  });

  it("throws JsonExtractError carrying the raw text on invalid JSON", () => {
    const raw = "{not json";
    try {
      extractJson(raw);
      throw new Error("expected extractJson to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(JsonExtractError);
      expect((e as JsonExtractError).raw).toBe(raw);
      expect((e as JsonExtractError).message).toMatch(/invalid JSON/);
    }
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractJson("")).toThrow(JsonExtractError);
    expect(() => extractJson("no braces here")).toThrow(/no JSON value/);
  });
});
```

`tests/shared/anthropic.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeClaudeCall } from "@/src/shared/anthropic";
import { LIMITS } from "@/src/shared/config";

describe("makeClaudeCall", () => {
  it("sends system + user with the default timeout and returns concatenated text blocks", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }],
    });
    const call = makeClaudeCall({ messages: { create } } as never);
    const out = await call({ model: "m", system: "S", user: "U", maxTokens: 10 });
    expect(out).toBe("hello world");
    expect(create).toHaveBeenCalledWith(
      { model: "m", max_tokens: 10, system: "S", messages: [{ role: "user", content: "U" }] },
      { timeout: LIMITS.modelTimeoutMs },
    );
  });

  it("throws when the output was truncated at max_tokens", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "partial" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const call = makeClaudeCall({ messages: { create } } as never);
    await expect(call({ model: "m", system: "S", user: "U" })).rejects.toThrow(/truncated/);
  });

  it("throws when the response has no text", async () => {
    const create = vi.fn().mockResolvedValue({ content: [] });
    const call = makeClaudeCall({ messages: { create } } as never);
    await expect(call({ model: "m", system: "S", user: "U" })).rejects.toThrow(/no text/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm test
```

Expected: FAIL with `Cannot find module '@/src/shared/types'` (and the same for config, json, anthropic).

- [ ] **Step 4: Write `src/shared/types.ts`** (exact copy of the header block)

```ts
import { z } from "zod";

export const Energy = z.enum(["low", "medium", "medium-high", "high"]);
export const Pacing = z.enum(["slow", "medium", "fast"]);

export const ImportantMoment = z.object({
  time: z.number().min(0),
  type: z.string(), // e.g. "scene_change", "main_visual_reveal", "climax"
  note: z.string().optional(),
});
export type ImportantMoment = z.infer<typeof ImportantMoment>;

export const VideoAnalysis = z.object({
  summary: z.string(),
  content_type: z.string(), // free text, e.g. "fashion lifestyle reel"
  content_category: z.string(), // one of CONTENT_CATEGORIES in config.ts
  setting: z.string().nullable(),
  story: z.string().nullable(),
  aesthetic: z.array(z.string()),
  mood: z.array(z.string()),
  energy: Energy,
  pacing: Pacing,
  dialogue_present: z.boolean(),
  important_moments: z.array(ImportantMoment),
});
export type VideoAnalysis = z.infer<typeof VideoAnalysis>;

export const MusicBriefFields = z.object({
  moods: z.array(z.string()),
  energy: z.number().min(0).max(1),
  tempo_preference: z.enum(["slow", "medium", "medium-high", "high"]),
  vocal_preference: z.enum(["vocals", "instrumental", "either"]),
  genre_preferences: z.array(z.string()),
  genre_avoid: z.array(z.string()),
  dialogue_present: z.boolean(),
  desired_cultural_relevance: z.enum(["low", "medium", "high"]),
  desired_familiarity: z.enum(["recognizable", "recognizable_not_overused", "unexpected"]),
});
export type MusicBriefFields = z.infer<typeof MusicBriefFields>;

export const MusicBrief = z.object({ text: z.string(), fields: MusicBriefFields });
export type MusicBrief = z.infer<typeof MusicBrief>;

export const AnalysisResult = z.object({
  analysis: VideoAnalysis,
  brief: MusicBrief,
  transcript: z.string(),
  prompt_version: z.string(),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;

export const DirectionTag = z.enum(["safe", "current", "unexpected"]);
export type DirectionTag = z.infer<typeof DirectionTag>;
export const DIRECTION_LABEL: Record<DirectionTag, string> = {
  safe: "Best fit",
  current: "More current",
  unexpected: "Unexpected",
};

export const GeneratedCandidate = z.object({
  title: z.string(),
  artist: z.string(),
  proposed_start: z.number().min(0),
  proposed_end: z.number().min(0),
  anchor_seconds: z.number().min(0), // the model's claimed musical hit (chorus entry, drop) inside the window
  section_is_vocal: z.boolean(), // does the proposed section carry lead vocals
  section_reason: z.string(),
  fit_reason: z.string(),
  directions: z.array(DirectionTag).min(1), // every generation direction that proposed it (dedupe keeps all)
});
export type GeneratedCandidate = z.infer<typeof GeneratedCandidate>;

export const VerifiedCandidate = GeneratedCandidate.extend({
  deezer_id: z.string(),
  canonical_title: z.string(), // provider's title, stored verbatim
  canonical_artist: z.string(),
  duration_seconds: z.number(),
  artwork_url: z.string().nullable(),
  deezer_url: z.string(),
  preview_url: z.string().nullable(), // null when previews are disabled (config.PREVIEWS_ENABLED)
});
export type VerifiedCandidate = z.infer<typeof VerifiedCandidate>;

export const DIMENSIONS = [
  "semantic",
  "emotional",
  "aesthetic",
  "pacing",
  "dialogue",
  "cultural",
  "originality",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const ComponentScore = z.object({ score: z.number().min(0).max(1), reason: z.string() });
export type ComponentScore = z.infer<typeof ComponentScore>;
export type ComponentScores = Record<Dimension, ComponentScore>;

export const ScoredCandidate = VerifiedCandidate.extend({
  component_scores: z.record(z.enum(DIMENSIONS), ComponentScore),
  total_score: z.number(),
});
export type ScoredCandidate = z.infer<typeof ScoredCandidate>;

export const Pick = ScoredCandidate.extend({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  direction_label: z.string(), // rank 1 is always "Best fit"; ranks 2–3 get DIRECTION_LABEL of their primary direction
  start_seconds: z.number(),
  end_seconds: z.number(),
  aligned_to_moment: z.number().nullable(), // video time T the anchor was aligned to, or null when no alignment was claimed
});
export type Pick = z.infer<typeof Pick>;

export const FinalRecommendation = Pick.extend({
  explanation: z.string(),
  spotify_url: z.string(),
  itunes_id: z.string().nullable(),
});
export type FinalRecommendation = z.infer<typeof FinalRecommendation>;

/** The ONLY shape sent to the browser. No scores, reasons, directions or provider internals. */
export const RecommendationView = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  direction_label: z.string(),
  title: z.string(),
  artist: z.string(),
  start_seconds: z.number(),
  end_seconds: z.number(),
  explanation: z.string(),
  artwork_url: z.string().nullable(),
  preview_url: z.string().nullable(),
  spotify_url: z.string(),
  selected: z.boolean(),
  rejected: z.boolean(),
});
export type RecommendationView = z.infer<typeof RecommendationView>;

export const SubmissionStatus = z.enum(["uploaded", "analyzing", "recommending", "ready", "failed"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;
```

- [ ] **Step 5: Write `src/shared/config.ts`**

```ts
export const MODELS = {
  analysis: "claude-fable-5-1",
  candidates: "claude-sonnet-5-5",
  scoring: "claude-sonnet-5-5",
  explain: "claude-sonnet-5-5",
  whisper: "whisper-1",
} as const;

export const LIMITS = {
  maxUploadBytes: 150 * 1024 * 1024,
  maxDurationSeconds: 180,
  maxFrames: 60,
  frameWidth: 512,
  candidatesPerDirection: 25,
  deezerConcurrency: 6,
  deezerTimeoutMs: 8_000,
  sectionMin: 12,
  sectionMax: 20,
  sectionDefault: 15,
  pipelineBudgetMs: 280_000,
  modelTimeoutMs: 120_000,
  inFlightStaleMinutes: 6,
} as const;

/** C8 ruling: no audio previews at launch unless Dylan enables them. */
export const PREVIEWS_ENABLED = false;

/** Must match the literal in the create_submission() SQL function (supabase/migrations/0001_init.sql). */
export const FREE_RESULTS_PER_CREATOR = 1;

export const CONTENT_CATEGORIES = [
  "fashion",
  "beauty",
  "fitness",
  "travel",
  "food",
  "lifestyle",
  "comedy",
  "music",
  "dance",
  "education",
  "business",
  "gaming",
  "pets",
  "family",
  "other",
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

/** Read a required environment variable. Throws with the variable name if unset or empty. */
export function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Comma-separated admin emails, lower-cased. Empty array if unset. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
```

- [ ] **Step 6: Write `src/shared/errors.ts`**

```ts
export type PipelineStage = "upload" | "analyze" | "recommend";

/**
 * Thrown by any pipeline stage. `raw` carries the model's raw text when a
 * response failed to parse so the admin can see exactly what came back.
 */
export class PipelineError extends Error {
  readonly stage: PipelineStage;
  readonly raw: string | undefined;

  constructor(stage: PipelineStage, message: string, raw?: string) {
    super(`[${stage}] ${message}`);
    this.name = "PipelineError";
    this.stage = stage;
    this.raw = raw;
  }
}

export function isPipelineError(e: unknown): e is PipelineError {
  return e instanceof PipelineError;
}

/** Thrown by createSubmission() when the database refuses a submission because the free result is used up. */
export class PaywallError extends Error {
  readonly reason = "needs_subscription" as const;
  constructor() {
    super("needs_subscription");
    this.name = "PaywallError";
  }
}

export function isPaywallError(e: unknown): e is PaywallError {
  return e instanceof PaywallError;
}
```

- [ ] **Step 7: Write `src/shared/logger.ts`**

```ts
type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, msg: string, data?: Record<string, unknown>): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** The one logger. Import as `logger` everywhere; there is no `log` export. */
export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => write("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
};
```

- [ ] **Step 8: Write `src/shared/json.ts`**

```ts
/** Thrown when model output holds no parseable JSON. `raw` is the full model text for the admin inspector. */
export class JsonExtractError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "JsonExtractError";
    this.raw = raw;
  }
}

/**
 * Pulls the first JSON object or array out of model text. Strips a ```json fence
 * if present, then parses from the first `{` or `[` to the matching last closer.
 * Returns `unknown`; callers validate with Zod.
 */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();

  const firstObj = t.indexOf("{");
  const firstArr = t.indexOf("[");
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  if (starts.length === 0) throw new JsonExtractError("no JSON value found in model output", text);

  const start = Math.min(...starts);
  const closer = t[start] === "{" ? "}" : "]";
  const end = t.lastIndexOf(closer);
  if (end <= start) throw new JsonExtractError("no JSON value found in model output", text);

  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch (e) {
    throw new JsonExtractError(`invalid JSON in model output: ${(e as Error).message}`, text);
  }
}
```

- [ ] **Step 9: Write `src/shared/anthropic.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { env, LIMITS } from "./config";
import { logger } from "./logger";

export type ClaudeCall = (args: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number; // per-call override; defaults to LIMITS.modelTimeoutMs (or the makeClaudeCall default)
}) => Promise<string>;

/**
 * Builds a text-in / text-out caller around an Anthropic client. Every text-only
 * stage (candidates, scoring, explanations) uses this; tests inject a stub client.
 * `timeoutMs` is passed as the SDK request timeout so a hung call cannot eat the
 * pipeline budget.
 */
export function makeClaudeCall(
  client: Pick<Anthropic, "messages">,
  opts: { timeoutMs?: number } = {},
): ClaudeCall {
  const defaultTimeout = opts.timeoutMs ?? LIMITS.modelTimeoutMs;
  return async ({ model, system, user, maxTokens = 4000, timeoutMs }) => {
    const started = Date.now();
    const res = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      },
      { timeout: timeoutMs ?? defaultTimeout },
    );
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    // One structured line per model call so cost and truncation are visible in logs (ruling I1).
    logger.info("model.call", {
      model,
      ms: Date.now() - started,
      input_tokens: res.usage?.input_tokens ?? null,
      output_tokens: res.usage?.output_tokens ?? null,
      stop_reason: res.stop_reason ?? null,
    });
    if (res.stop_reason === "max_tokens") throw new Error("claude: output truncated at max_tokens");
    if (!text) throw new Error("claude: no text in response");
    return text;
  };
}

let singleton: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (!singleton) singleton = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  return singleton;
}

/** Default caller used in production. Lazily constructs the client so tests never need a key. */
export const callClaude: ClaudeCall = (args) => makeClaudeCall(defaultClient())(args);
```

`analyzeVideo` (Task 2.3) keeps its own client because it sends image blocks; every text-only stage in Phase 3 uses `callClaude`.

- [ ] **Step 10: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: `Test Files  4 passed`, `Tests  24 passed` (types 8, config 7, json 6, anthropic 3).

- [ ] **Step 11: Typecheck and commit**

```bash
pnpm typecheck
git add vitest.config.ts src/shared tests/shared tests/stubs
git commit -m "Add shared config, Zod types, errors, logger, JSON extraction and Claude caller"
```

---

### Task 0.3: Hosted Supabase project, migrations, paywall and claim functions

**Files:**
- Modify: `docs/DATA_MODEL.md` (new columns on `candidates`, `recommendations`, `video_analyses`, `submissions`; new `stripe_events` table; the two SQL functions)
- Create: `supabase/config.toml` (generated by `supabase init`), `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_catalog.sql`, `supabase/migrations/0003_rls.sql`
- Create (generated): `src/db/types.ts`

**Interfaces:**
- Consumes: Dylan's hosted Supabase project (`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, service keys in `.env.local`) and a one-time CLI login.
- Produces: every table in `docs/DATA_MODEL.md`, the `videos` storage bucket, the SQL functions `create_submission(p_id, p_creator_id, p_video_path, p_intent)` (atomic paywall + insert, raises `needs_subscription`) and `claim_submission_run(p_id)` (atomic run claim, returns the row or null), the `stripe_events` table, and the generated `Database` type in `src/db/types.ts` that Task 0.4 imports.

- [ ] **Step 1: Update `docs/DATA_MODEL.md` first**

In `## submissions`, add after `viewed_at`:

```markdown
| updated_at        | timestamptz | set by trigger on every update; used for stale-run detection |
```

In `## video_analyses`, add after `content_type`:

```markdown
| content_category    | text        | one of CONTENT_CATEGORIES; mirrored onto submissions   |
```

In `## candidates`, replace the single `generator_reason` row with these rows (keep `component_scores`, `total_score`, `prompt_version` after them):

```markdown
| anchor_seconds    | numeric     | the model's claimed musical hit inside the window   |
| section_is_vocal  | boolean     | lead vocals in the proposed section                 |
| section_reason    | text        | what happens musically at the section               |
| fit_reason        | text        | why it fits this video                              |
| directions        | text[]      | every generation direction that proposed it         |
| canonical_title   | text        | nullable, provider's title verbatim                 |
| canonical_artist  | text        | nullable, provider's artist verbatim                |
| artwork_url       | text        | nullable, from Deezer                               |
| deezer_url        | text        | nullable, from Deezer                               |
| preview_url       | text        | nullable, 30s Deezer preview                        |
| source            | text        | 'model' now; 'catalog' later                        |
| segment_id        | uuid        | nullable, → song_segments ON DELETE SET NULL (later) |
| aligned_to_moment | numeric     | nullable, video time the anchor was aligned to      |
```

In `## recommendations`, add after `preview_url`:

```markdown
| selected              | boolean     | default false; at most one true per submission     |
| rejected              | boolean     | default false                                      |
| explain_prompt_version| text        | nullable                                           |
| aligned_to_moment     | numeric     | nullable                                           |
```

Add a new section before `## Catalog tables`:

```markdown
## stripe_events
Idempotency record for the Stripe webhook. A row is written only AFTER the
event was processed successfully, so a failed activation stays retryable.

| column        | type        | notes                      |
|---------------|-------------|----------------------------|
| id            | text        | Stripe event id, primary key |
| type          | text        |                            |
| processed_at  | timestamptz | default now()              |

RLS: service role only.

## SQL functions (security definer, service role only)
- `create_submission(p_id uuid, p_creator_id uuid, p_video_path text, p_intent text) returns submissions`
  — takes a per-creator advisory lock, counts the creator's `ready` rows plus
  in-flight rows (`uploaded|analyzing|recommending` updated in the last 10
  minutes), checks for an active subscription, raises `needs_subscription`
  when count ≥ 1 and not subscribed, otherwise inserts and returns the row.
  Idempotent on `p_id` for the same creator. The literal `1` matches
  `FREE_RESULTS_PER_CREATOR` in `src/shared/config.ts`.
- `claim_submission_run(p_id uuid) returns submissions` — one conditional
  update: moves `uploaded|failed` to `analyzing`, or re-claims an in-flight
  row whose `updated_at` is older than 6 minutes (status unchanged so the
  runner resumes from stored outputs). Never touches `ready`. Returns the
  row, or null when nothing was claimed.
```

Also change the `## subscriptions` note for `stripe_subscription_id` to: `nullable, plain UNIQUE (nulls allowed)`.

- [ ] **Step 2: Log in to the Supabase CLI and link the hosted project**

Dylan runs the login himself (it opens a browser), by typing this in the Claude prompt:

```
! npx supabase login
```

Then, with `.env.local` filled in (`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`):

```bash
set -a; source .env.local; set +a
pnpm supabase init
pnpm supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
```

Expected: `supabase init` prints `Finished supabase init.` and creates `supabase/config.toml`. `supabase link` prints `Finished supabase link.` and writes `supabase/.temp/project-ref` (git-ignored). If `link` reports a pooler/connection error, re-check `SUPABASE_DB_PASSWORD`; it is the database password from project creation, not the service-role key.

Google auth is configured in the Supabase dashboard (Task 1.6), not in `config.toml`.

- [ ] **Step 3: Write `supabase/migrations/0001_init.sql`**

```sql
-- Songfit core tables, functions and bucket. See docs/DATA_MODEL.md.
create extension if not exists "pgcrypto";

-- creators -----------------------------------------------------------------
create table public.creators (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text,
  preferences jsonb,
  created_at timestamptz not null default now()
);

-- Mirror every new auth user into creators.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.creators (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- shared updated_at trigger ------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- submissions --------------------------------------------------------------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (id) on delete cascade,
  video_path text not null,
  duration_seconds numeric,
  creator_intent text,
  content_category text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'analyzing', 'recommending', 'ready', 'failed')),
  error text,
  analyzed_at timestamptz,
  recommended_at timestamptz,
  viewed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index submissions_creator_id_idx on public.submissions (creator_id);
create index submissions_status_idx on public.submissions (status);
create index submissions_created_at_idx on public.submissions (created_at desc);

create trigger submissions_set_updated_at
before update on public.submissions
for each row execute function public.set_updated_at();

-- video_analyses -----------------------------------------------------------
create table public.video_analyses (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  summary text not null,
  content_type text not null,
  content_category text,
  setting text,
  story text,
  aesthetic text[] not null default '{}',
  mood text[] not null default '{}',
  energy text not null,
  pacing text not null,
  dialogue_present boolean not null default false,
  transcript text,
  important_moments jsonb not null default '[]'::jsonb,
  music_brief text not null,
  music_brief_fields jsonb not null,
  prompt_version text not null,
  raw_response jsonb,
  created_at timestamptz not null default now()
);

-- candidates ---------------------------------------------------------------
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  song_id uuid,     -- FK to songs added in 0002_catalog.sql
  segment_id uuid,  -- FK to song_segments added in 0002_catalog.sql
  title text not null,
  artist text not null,
  canonical_title text,
  canonical_artist text,
  deezer_id text,
  itunes_id text,
  duration_seconds numeric,
  verified boolean not null default false,
  proposed_start numeric not null,
  proposed_end numeric not null,
  anchor_seconds numeric not null,
  section_is_vocal boolean not null default false,
  section_reason text not null,
  fit_reason text not null,
  directions text[] not null default '{}',
  artwork_url text,
  deezer_url text,
  preview_url text,
  source text not null default 'model' check (source in ('model', 'catalog')),
  aligned_to_moment numeric,
  component_scores jsonb,
  total_score numeric,
  prompt_version text not null,
  created_at timestamptz not null default now()
);
create index candidates_submission_id_idx on public.candidates (submission_id);

-- recommendations ----------------------------------------------------------
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  candidate_id uuid references public.candidates (id) on delete set null,
  rank int not null check (rank in (1, 2, 3)),
  direction_label text not null,
  title text not null,
  artist text not null,
  start_seconds numeric not null,
  end_seconds numeric not null,
  explanation text not null,
  spotify_url text not null,
  deezer_url text,
  artwork_url text,
  preview_url text,
  selected boolean not null default false,
  rejected boolean not null default false,
  explain_prompt_version text,
  aligned_to_moment numeric,
  created_at timestamptz not null default now(),
  unique (submission_id, rank)
);

-- events -------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.creators (id) on delete set null,
  submission_id uuid references public.submissions (id) on delete set null,
  name text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index events_name_idx on public.events (name);
create index events_submission_id_idx on public.events (submission_id);
create index events_creator_id_idx on public.events (creator_id);
create index events_created_at_idx on public.events (created_at desc);

-- subscriptions ------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text unique, -- plain UNIQUE: nulls may repeat, supports ON CONFLICT upsert
  status text not null check (status in ('active', 'canceled', 'past_due')),
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index subscriptions_creator_id_idx on public.subscriptions (creator_id);

-- stripe_events ------------------------------------------------------------
-- Written only AFTER an event is processed successfully (C4 ruling).
create table public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

-- paywall + insert, atomic --------------------------------------------------
-- The literal `1` is FREE_RESULTS_PER_CREATOR in src/shared/config.ts.
create or replace function public.create_submission(
  p_id uuid,
  p_creator_id uuid,
  p_video_path text,
  p_intent text
)
returns public.submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.submissions;
  used_count int;
  subscribed boolean;
  created public.submissions;
begin
  -- Serialize per creator so two concurrent uploads cannot both pass the count.
  perform pg_advisory_xact_lock(hashtext(p_creator_id::text));

  -- Idempotent: the same creator re-posting the same id gets the same row.
  select * into existing from public.submissions where id = p_id;
  if found then
    if existing.creator_id <> p_creator_id then
      raise exception 'forbidden';
    end if;
    return existing;
  end if;

  select count(*) into used_count
  from public.submissions
  where creator_id = p_creator_id
    and (
      status = 'ready'
      or (status in ('uploaded', 'analyzing', 'recommending')
          and updated_at > now() - interval '10 minutes')
    );

  select exists (
    select 1 from public.subscriptions
    where creator_id = p_creator_id and status = 'active'
  ) into subscribed;

  if used_count >= 1 and not subscribed then
    raise exception 'needs_subscription';
  end if;

  insert into public.submissions (id, creator_id, video_path, creator_intent, status)
  values (p_id, p_creator_id, p_video_path, p_intent, 'uploaded')
  returning * into created;
  return created;
end;
$$;

-- atomic run claim -----------------------------------------------------------
-- Moves uploaded|failed → analyzing, or re-claims a stale in-flight row (older
-- than 6 minutes, status kept so the runner resumes from stored outputs).
-- Never touches ready. Returns null when nothing was claimed.
create or replace function public.claim_submission_run(p_id uuid)
returns public.submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.submissions;
begin
  update public.submissions
     set status = case when status in ('uploaded', 'failed') then 'analyzing' else status end,
         updated_at = now()
   where id = p_id
     and status <> 'ready'
     and (status in ('uploaded', 'failed') or updated_at < now() - interval '6 minutes')
  returning * into claimed;
  return claimed;
end;
$$;

revoke execute on function public.create_submission(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.claim_submission_run(uuid) from public, anon, authenticated;
grant execute on function public.create_submission(uuid, uuid, text, text) to service_role;
grant execute on function public.claim_submission_run(uuid) to service_role;

-- storage ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('videos', 'videos', false, 157286400)
on conflict (id) do nothing;
```

Note on the bucket limit: Supabase Free caps uploads at 50 MB regardless of `file_size_limit`; the 150 MB limit only takes effect on Supabase Pro (C7 ruling, Dylan's decision 3). Until then, uploads over 50 MB fail at Storage; Task 1.4's client check uses `LIMITS.maxUploadBytes`, so lower that constant if the project stays on Free.

- [ ] **Step 4: Write `supabase/migrations/0002_catalog.sql`**

```sql
-- Catalog tables. Created now, populated after launch. See docs/DATA_MODEL.md.
create extension if not exists vector;

create table public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null,
  deezer_id text unique,
  itunes_id text,
  genres text[] not null default '{}',
  moods text[] not null default '{}',
  aesthetics text[] not null default '{}',
  energy numeric,
  bpm numeric,
  vocal_type text,
  language text,
  cultural_tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.song_segments (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  start_seconds numeric not null,
  end_seconds numeric not null,
  label text not null
    check (label in ('intro', 'verse', 'pre-chorus', 'chorus', 'drop', 'bridge', 'break', 'hook')),
  description text not null,
  moods text[] not null default '{}',
  energy numeric,
  lyrics_snippet text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index song_segments_song_id_idx on public.song_segments (song_id);

create table public.song_trend_signals (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram')),
  popularity_score numeric not null,
  growth_score numeric not null,
  saturation_score numeric not null,
  content_categories text[] not null default '{}',
  observed_at timestamptz not null default now(),
  source text not null check (source in ('manual', 'api')),
  created_at timestamptz not null default now()
);
create index song_trend_signals_song_id_idx on public.song_trend_signals (song_id);

alter table public.candidates
  add constraint candidates_song_id_fkey
  foreign key (song_id) references public.songs (id) on delete set null;
alter table public.candidates
  add constraint candidates_segment_id_fkey
  foreign key (segment_id) references public.song_segments (id) on delete set null;
```

- [ ] **Step 5: Write `supabase/migrations/0003_rls.sql`**

```sql
-- Row Level Security. Creators see only their own rows. Tables with no
-- policies are service-role only (the service role bypasses RLS).
-- There is deliberately NO insert policy on submissions: rows are created
-- only through create_submission() via the service role (C2 ruling).

alter table public.creators enable row level security;
create policy "creators: read own" on public.creators
  for select to authenticated using (auth.uid() = id);
create policy "creators: update own" on public.creators
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

alter table public.submissions enable row level security;
create policy "submissions: read own" on public.submissions
  for select to authenticated using (auth.uid() = creator_id);

alter table public.video_analyses enable row level security;
create policy "video_analyses: read own" on public.video_analyses
  for select to authenticated using (
    exists (
      select 1 from public.submissions s
      where s.id = video_analyses.submission_id and s.creator_id = auth.uid()
    )
  );

alter table public.candidates enable row level security;
-- no policies: service role only

alter table public.recommendations enable row level security;
create policy "recommendations: read own" on public.recommendations
  for select to authenticated using (
    exists (
      select 1 from public.submissions s
      where s.id = recommendations.submission_id and s.creator_id = auth.uid()
    )
  );

alter table public.events enable row level security;
-- no policies: service role only

alter table public.subscriptions enable row level security;
create policy "subscriptions: read own" on public.subscriptions
  for select to authenticated using (auth.uid() = creator_id);

alter table public.stripe_events enable row level security;
-- no policies: service role only

alter table public.songs enable row level security;
alter table public.song_segments enable row level security;
alter table public.song_trend_signals enable row level security;
-- no policies: service role only

-- Storage: creators upload to and read from their own folder in `videos`.
-- Signed upload URLs are issued by the server (Task 1.2); this policy scopes
-- any authenticated upload to the caller's own prefix.
create policy "videos: upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "videos: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 6: Push the migrations to the hosted project**

```bash
pnpm db:push
```

Expected: `Applying migration 0001_init.sql...`, `0002_catalog.sql...`, `0003_rls.sql...`, then `Finished supabase db push.` If `vector` fails to install, enable the `vector` extension once in the dashboard (Database → Extensions) and re-run.

- [ ] **Step 7: Verify the schema on the hosted project**

Write and run a throwaway check with the service client (no `psql` on this machine):

```bash
cat > /tmp/check-schema.mjs <<'EOF'
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
for (const t of ["creators","submissions","video_analyses","candidates","recommendations","events","subscriptions","stripe_events","songs","song_segments","song_trend_signals"]) {
  const { error } = await db.from(t).select("*", { head: true, count: "exact" });
  console.log(t.padEnd(20), error ? "FAIL " + error.message : "ok");
}
const { data: b } = await db.storage.getBucket("videos");
console.log("bucket videos".padEnd(20), b ? `ok public=${b.public} limit=${b.file_size_limit}` : "FAIL");
const { error: fe } = await db.rpc("claim_submission_run", { p_id: "00000000-0000-0000-0000-000000000000" });
console.log("claim_submission_run".padEnd(20), fe ? "FAIL " + fe.message : "ok (null row)");
EOF
node --env-file=.env.local /tmp/check-schema.mjs
```

Expected: every table `ok`, `bucket videos ok public=false limit=157286400`, `claim_submission_run ok (null row)`.

- [ ] **Step 8: Generate database types**

```bash
mkdir -p src/db
set -a; source .env.local; set +a
pnpm db:types
head -5 src/db/types.ts
grep -c "create_submission\|claim_submission_run" src/db/types.ts
```

Expected: file begins with `export type Json =`, contains `candidates: { Row: {` and `anchor_seconds`, and the grep prints `2` or more (both functions appear under `Functions`).

- [ ] **Step 9: Commit**

```bash
pnpm typecheck
git add docs/DATA_MODEL.md supabase/config.toml supabase/migrations src/db/types.ts
git commit -m "Add hosted Supabase migrations with paywall and run-claim functions, RLS and generated types"
```

---

### Task 0.4: Database clients and typed queries

**Files:**
- Create: `src/db/client.ts`, `src/db/browser.ts`, `src/db/queries/creators.ts`, `src/db/queries/submissions.ts`, `src/db/queries/analyses.ts`, `src/db/queries/candidates.ts`, `src/db/queries/recommendations.ts`, `src/db/queries/events.ts`, `src/db/queries/subscriptions.ts`, `src/db/queries/stripeEvents.ts`

**Interfaces:**
- Consumes: `Database` from `src/db/types.ts` (Task 0.3); `env()` from `src/shared/config.ts`; `SubmissionStatus`, `VideoAnalysis`, `MusicBrief` from `src/shared/types.ts`; `PaywallError` from `src/shared/errors.ts`; `logger` from `src/shared/logger.ts` (Task 0.2).
- Produces:
  - `createServerClient(): Promise<SupabaseClient<Database>>`, `createServiceClient(): SupabaseClient<Database>` (in `client.ts`); `createBrowserClient(): SupabaseClient<Database>` (in `browser.ts`).
  - `ensureCreator(id, email, displayName?)`, `getCreatorByEmail(email)`, `getCreator(id)`
  - `getSubmission(id)`, `createSubmission({ id, creatorId, videoPath, creatorIntent })` (rpc `create_submission`; throws `PaywallError` on `needs_subscription`), `claimSubmissionRun(id)` (rpc `claim_submission_run`; row or null), `setSubmissionStatus(id, status, error?)`, `setSubmissionAnalyzed(id, { durationSeconds, contentCategory })`, `markSubmissionViewed(id)`, `listSubmissions(limit?)` → `SubmissionWithCreator[]`, `listSubmissionsForCreator(creatorId)`, `countReadySubmissions(creatorId)`, `countSubmissionsForCreator(creatorId)`
  - `upsertAnalysis(row)`, `getAnalysisRow(submissionId)`, `getAnalysis(submissionId)` → `{ analysis, brief, row } | null`
  - `replaceCandidates(submissionId, rows: CandidateInsert[]): Promise<CandidateRow[]>`, `listCandidates(submissionId)`
  - `replaceRecommendations(submissionId, rows: RecommendationInsert[]): Promise<RecommendationRow[]>`, `listRecommendations(submissionId)`, `markRecommendationFeedback(submissionId, rank, { selected?, rejected? })`
  - `insertEvent(row)`, `listEventsForSubmission(submissionId)`, `countEventsByName()`, `listEvents(limit?)`
  - `getActiveSubscription(creatorId)`, `activateSubscription({ creatorId, stripeCustomerId, stripeSubscriptionId })`, `setSubscriptionStatus(stripeSubscriptionId, status)`
  - `recordStripeEvent(id, type)` (insert; a duplicate id is ignored and returns `false`)
  - Row type aliases: `SubmissionRow`, `AnalysisRow`, `CandidateRow`, `RecommendationRow`, `EventRow`, `SubscriptionRow`, `CreatorRow`, and `Insert` variants (`CandidateInsert`, `RecommendationInsert`, `AnalysisInsert`, `EventInsert`).

No unit tests in this task: every function is a thin typed wrapper over Supabase with no branching logic beyond error mapping. Verified by `pnpm typecheck` against the generated `Database` type, and exercised end to end in Phase 1.

- [ ] **Step 1: Write `src/db/client.ts`**

```ts
import "server-only";
import { createServerClient as createSsrServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "@/src/shared/config";
import type { Database } from "./types";

export type Db = SupabaseClient<Database>;

/** Cookie-bound client that respects RLS. Use in server components, route handlers and server actions. */
export async function createServerClient(): Promise<Db> {
  const cookieStore = await cookies();
  return createSsrServerClient<Database>(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; middleware refreshes the session instead.
          }
        },
      },
    },
  );
}

let serviceClient: Db | undefined;

/** Service-role client that bypasses RLS. Server only. Never expose to the browser. */
export function createServiceClient(): Db {
  if (!serviceClient) {
    serviceClient = createClient<Database>(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return serviceClient;
}
```

- [ ] **Step 2: Write `src/db/browser.ts`**

```ts
"use client";
import { createBrowserClient as createSsrBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

let client: SupabaseClient<Database> | undefined;

/** Browser client (anon key, RLS enforced). Safe for client components. */
export function createBrowserClient(): SupabaseClient<Database> {
  if (!client) {
    client = createSsrBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    );
  }
  return client;
}
```

- [ ] **Step 3: Write `src/db/queries/creators.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type CreatorRow = Database["public"]["Tables"]["creators"]["Row"];

export async function getCreator(id: string): Promise<CreatorRow | null> {
  const { data, error } = await createServiceClient().from("creators").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCreatorByEmail(email: string): Promise<CreatorRow | null> {
  const { data, error } = await createServiceClient()
    .from("creators")
    .select("*")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Idempotent. The auth trigger normally creates the row; this covers users created before the trigger existed. */
export async function ensureCreator(id: string, email: string, displayName?: string | null): Promise<CreatorRow> {
  const { data, error } = await createServiceClient()
    .from("creators")
    .upsert({ id, email: email.toLowerCase(), display_name: displayName ?? null }, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Write `src/db/queries/submissions.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";
import type { SubmissionStatus } from "@/src/shared/types";
import { PaywallError } from "@/src/shared/errors";

export type SubmissionRow = Database["public"]["Tables"]["submissions"]["Row"];

export async function getSubmission(id: string): Promise<SubmissionRow | null> {
  const { data, error } = await createServiceClient().from("submissions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Creates the submission through the create_submission() SQL function, which
 * enforces the paywall atomically (one free result per creator unless
 * subscribed) and is idempotent on `id` for the same creator.
 * Throws PaywallError when the database raises `needs_subscription`.
 */
export async function createSubmission(input: {
  id: string;
  creatorId: string;
  videoPath: string;
  creatorIntent: string | null;
}): Promise<SubmissionRow> {
  const { data, error } = await createServiceClient().rpc("create_submission", {
    p_id: input.id,
    p_creator_id: input.creatorId,
    p_video_path: input.videoPath,
    p_intent: input.creatorIntent,
  });
  if (error) {
    if (error.message.includes("needs_subscription")) throw new PaywallError();
    throw error;
  }
  if (!data) throw new Error("create_submission returned no row");
  return data as SubmissionRow;
}

/**
 * Atomically claims the submission for a pipeline run via claim_submission_run().
 * Returns the claimed row, or null when another run holds it (or it is already ready).
 */
export async function claimSubmissionRun(id: string): Promise<SubmissionRow | null> {
  const { data, error } = await createServiceClient().rpc("claim_submission_run", { p_id: id });
  if (error) throw error;
  // A composite-returning function yields null (or a row with null id) when nothing matched.
  if (!data || !(data as SubmissionRow).id) return null;
  return data as SubmissionRow;
}

export async function setSubmissionStatus(
  id: string,
  status: SubmissionStatus,
  error?: string | null,
): Promise<void> {
  const patch: Database["public"]["Tables"]["submissions"]["Update"] = { status, error: error ?? null };
  const db = createServiceClient();
  if (status === "ready") {
    // Preserve the first readiness timestamp across retries (I7 ruling).
    const { data } = await db.from("submissions").select("recommended_at").eq("id", id).maybeSingle();
    if (!data?.recommended_at) patch.recommended_at = new Date().toISOString();
  }
  const { error: dbError } = await db.from("submissions").update(patch).eq("id", id);
  if (dbError) throw dbError;
}

export async function setSubmissionAnalyzed(
  id: string,
  input: { durationSeconds: number; contentCategory: string },
): Promise<void> {
  const { error } = await createServiceClient()
    .from("submissions")
    .update({
      duration_seconds: input.durationSeconds,
      content_category: input.contentCategory,
      analyzed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/** Sets viewed_at only the first time. */
export async function markSubmissionViewed(id: string): Promise<void> {
  const { error } = await createServiceClient()
    .from("submissions")
    .update({ viewed_at: new Date().toISOString() })
    .eq("id", id)
    .is("viewed_at", null);
  if (error) throw error;
}

export type SubmissionWithCreator = SubmissionRow & { creator: { email: string } | null };

/** Admin queue: every submission, newest first, with the creator's email joined. */
export async function listSubmissions(limit = 200): Promise<SubmissionWithCreator[]> {
  const { data, error } = await createServiceClient()
    .from("submissions")
    .select("*, creator:creators(email)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function listSubmissionsForCreator(creatorId: string): Promise<SubmissionRow[]> {
  const { data, error } = await createServiceClient()
    .from("submissions")
    .select("*")
    .eq("creator_id", creatorId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** UX-only paywall preview (the database enforces the real rule): finished results for this creator. */
export async function countReadySubmissions(creatorId: string): Promise<number> {
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .eq("status", "ready");
  if (error) throw error;
  return count ?? 0;
}

export async function countSubmissionsForCreator(creatorId: string): Promise<number> {
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId);
  if (error) throw error;
  return count ?? 0;
}
```

- [ ] **Step 5: Write `src/db/queries/analyses.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";
import { VideoAnalysis, MusicBrief } from "@/src/shared/types";

export type AnalysisRow = Database["public"]["Tables"]["video_analyses"]["Row"];
export type AnalysisInsert = Database["public"]["Tables"]["video_analyses"]["Insert"];

/** One analysis per submission; re-running the stage overwrites it. */
export async function upsertAnalysis(row: AnalysisInsert): Promise<AnalysisRow> {
  const { data, error } = await createServiceClient()
    .from("video_analyses")
    .upsert(row, { onConflict: "submission_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getAnalysisRow(submissionId: string): Promise<AnalysisRow | null> {
  const { data, error } = await createServiceClient()
    .from("video_analyses")
    .select("*")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Typed view used by the engine: rebuilds VideoAnalysis + MusicBrief from the
 * stored columns and validates them with Zod, so a hand-edited row fails loudly.
 */
export async function getAnalysis(
  submissionId: string,
): Promise<{ analysis: VideoAnalysis; brief: MusicBrief; row: AnalysisRow } | null> {
  const row = await getAnalysisRow(submissionId);
  if (!row) return null;
  const analysis = VideoAnalysis.parse({
    summary: row.summary,
    content_type: row.content_type,
    content_category: row.content_category ?? "other",
    setting: row.setting,
    story: row.story,
    aesthetic: row.aesthetic,
    mood: row.mood,
    energy: row.energy,
    pacing: row.pacing,
    dialogue_present: row.dialogue_present,
    important_moments: row.important_moments,
  });
  const brief = MusicBrief.parse({ text: row.music_brief, fields: row.music_brief_fields });
  return { analysis, brief, row };
}
```

- [ ] **Step 6: Write `src/db/queries/candidates.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];
export type CandidateInsert = Database["public"]["Tables"]["candidates"]["Insert"];

/** Idempotent per stage run: deletes the submission's candidates and inserts the new set. Returns the inserted rows (with ids). */
export async function replaceCandidates(submissionId: string, rows: CandidateInsert[]): Promise<CandidateRow[]> {
  const db = createServiceClient();
  const { error: delError } = await db.from("candidates").delete().eq("submission_id", submissionId);
  if (delError) throw delError;
  if (rows.length === 0) return [];
  const { data, error } = await db
    .from("candidates")
    .insert(rows.map((r) => ({ ...r, submission_id: submissionId })))
    .select("*");
  if (error) throw error;
  return data;
}

export async function listCandidates(submissionId: string): Promise<CandidateRow[]> {
  const { data, error } = await createServiceClient()
    .from("candidates")
    .select("*")
    .eq("submission_id", submissionId)
    .order("total_score", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data;
}
```

- [ ] **Step 7: Write `src/db/queries/recommendations.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type RecommendationRow = Database["public"]["Tables"]["recommendations"]["Row"];
export type RecommendationInsert = Database["public"]["Tables"]["recommendations"]["Insert"];

/** Idempotent per stage run: replaces the submission's 3 recommendations. */
export async function replaceRecommendations(
  submissionId: string,
  rows: RecommendationInsert[],
): Promise<RecommendationRow[]> {
  const db = createServiceClient();
  const { error: delError } = await db.from("recommendations").delete().eq("submission_id", submissionId);
  if (delError) throw delError;
  if (rows.length === 0) return [];
  const { data, error } = await db
    .from("recommendations")
    .insert(rows.map((r) => ({ ...r, submission_id: submissionId })))
    .select("*")
    .order("rank", { ascending: true });
  if (error) throw error;
  return data;
}

export async function listRecommendations(submissionId: string): Promise<RecommendationRow[]> {
  const { data, error } = await createServiceClient()
    .from("recommendations")
    .select("*")
    .eq("submission_id", submissionId)
    .order("rank", { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Records creator feedback on one rank. Selection is exclusive: selecting a
 * rank clears `selected` on the other two first. Returns the number of rows
 * updated for the target rank (0 means the rank did not exist).
 */
export async function markRecommendationFeedback(
  submissionId: string,
  rank: 1 | 2 | 3,
  patch: { selected?: boolean; rejected?: boolean },
): Promise<number> {
  const db = createServiceClient();
  if (patch.selected === true) {
    const { error: clearError } = await db
      .from("recommendations")
      .update({ selected: false })
      .eq("submission_id", submissionId)
      .neq("rank", rank);
    if (clearError) throw clearError;
  }
  const update: Database["public"]["Tables"]["recommendations"]["Update"] = {};
  if (patch.selected !== undefined) update.selected = patch.selected;
  if (patch.rejected !== undefined) update.rejected = patch.rejected;
  if (patch.selected === true) update.rejected = false;
  const { data, error } = await db
    .from("recommendations")
    .update(update)
    .eq("submission_id", submissionId)
    .eq("rank", rank)
    .select("id");
  if (error) throw error;
  return data.length;
}
```

- [ ] **Step 8: Write `src/db/queries/events.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type EventRow = Database["public"]["Tables"]["events"]["Row"];
export type EventInsert = Database["public"]["Tables"]["events"]["Insert"];

export async function insertEvent(row: EventInsert): Promise<void> {
  const { error } = await createServiceClient().from("events").insert(row);
  if (error) throw error;
}

export async function listEventsForSubmission(submissionId: string): Promise<EventRow[]> {
  const { data, error } = await createServiceClient()
    .from("events")
    .select("*")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

/** Returns { name: count } across all events. Used by the admin metrics page. */
export async function countEventsByName(): Promise<Record<string, number>> {
  const { data, error } = await createServiceClient().from("events").select("name");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data) counts[row.name] = (counts[row.name] ?? 0) + 1;
  return counts;
}

export async function listEvents(limit = 5000): Promise<EventRow[]> {
  const { data, error } = await createServiceClient()
    .from("events")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data;
}
```

- [ ] **Step 9: Write `src/db/queries/subscriptions.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];
export type SubscriptionStatus = "active" | "canceled" | "past_due";

export async function getActiveSubscription(creatorId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await createServiceClient()
    .from("subscriptions")
    .select("*")
    .eq("creator_id", creatorId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Idempotent on stripe_subscription_id (plain UNIQUE constraint in 0001_init.sql). */
export async function activateSubscription(input: {
  creatorId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): Promise<SubscriptionRow> {
  const { data, error } = await createServiceClient()
    .from("subscriptions")
    .upsert(
      {
        creator_id: input.creatorId,
        stripe_customer_id: input.stripeCustomerId,
        stripe_subscription_id: input.stripeSubscriptionId,
        status: "active",
        started_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setSubscriptionStatus(
  stripeSubscriptionId: string,
  status: SubscriptionStatus,
): Promise<void> {
  const { error } = await createServiceClient()
    .from("subscriptions")
    .update({ status })
    .eq("stripe_subscription_id", stripeSubscriptionId);
  if (error) throw error;
}
```

- [ ] **Step 10: Write `src/db/queries/stripeEvents.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import { logger } from "@/src/shared/logger";

/**
 * Records a Stripe event id AFTER it was processed successfully (C4 ruling).
 * Returns true when the row was written, false when the id already existed
 * (a redelivery that reached the end a second time; harmless).
 */
export async function recordStripeEvent(id: string, type: string): Promise<boolean> {
  const { error } = await createServiceClient().from("stripe_events").insert({ id, type });
  if (!error) return true;
  if (error.code === "23505") {
    logger.info("stripe event already recorded", { id, type });
    return false;
  }
  throw error;
}
```

- [ ] **Step 11: Typecheck and commit**

```bash
pnpm typecheck
```

Expected: exit 0. If `rpc("create_submission", …)` or `rpc("claim_submission_run", …)` fails to typecheck, `src/db/types.ts` was generated before the functions existed: re-run `pnpm db:push` then `pnpm db:types` and try again.

```bash
git add src/db
git commit -m "Add Supabase clients and typed query functions"
```

---

### Task 0.5: Event names and `logEvent`

**Files:**
- Create: `src/feedback/events.ts`
- Test: `tests/feedback/events.test.ts`

**Interfaces:**
- Consumes: `insertEvent` from `src/db/queries/events.ts` (Task 0.4); `logger` from `src/shared/logger.ts`.
- Produces: `EVENT_NAMES`, `EventName`, `isEventName(x): x is EventName`, `logEvent({ name, creatorId?, submissionId?, metadata? })`.

- [ ] **Step 1: Write the failing test**

`tests/feedback/events.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const insertEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/src/db/queries/events", () => ({ insertEvent }));

import { EVENT_NAMES, isEventName, logEvent } from "@/src/feedback/events";

/** Pulls the fenced list under "Allowed event names" out of docs/DATA_MODEL.md. */
function eventNamesFromDataModel(): string[] {
  const doc = readFileSync(path.join(process.cwd(), "docs", "DATA_MODEL.md"), "utf8");
  const start = doc.indexOf("Allowed event names");
  const fenceOpen = doc.indexOf("```", start);
  const fenceClose = doc.indexOf("```", fenceOpen + 3);
  const block = doc.slice(fenceOpen + 3, fenceClose);
  return block
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((name) => /^[a-z_0-9]+$/.test(name));
}

beforeEach(() => insertEvent.mockClear());

describe("EVENT_NAMES", () => {
  it("matches docs/DATA_MODEL.md exactly", () => {
    const documented = eventNamesFromDataModel();
    expect(documented.length).toBeGreaterThan(10);
    expect([...EVENT_NAMES].sort()).toEqual([...documented].sort());
  });

  it("isEventName guards unknown strings", () => {
    expect(isEventName("submission_created")).toBe(true);
    expect(isEventName("made_up_event")).toBe(false);
  });
});

describe("logEvent", () => {
  it("passes creatorId and submissionId through to the row", async () => {
    await logEvent({ name: "recommendations_ready", creatorId: "cre-1", submissionId: "sub-1", metadata: { ms: 90 } });
    expect(insertEvent).toHaveBeenCalledWith({
      name: "recommendations_ready",
      creator_id: "cre-1",
      submission_id: "sub-1",
      metadata: { ms: 90 },
    });
  });

  it("never throws when the insert fails", async () => {
    insertEvent.mockRejectedValueOnce(new Error("db down"));
    await expect(logEvent({ name: "paid" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/feedback
```

Expected: FAIL with `Cannot find module '@/src/feedback/events'`.

- [ ] **Step 3: Write `src/feedback/events.ts`**

```ts
import { insertEvent } from "@/src/db/queries/events";
import { logger } from "@/src/shared/logger";

/** Keep in sync with docs/DATA_MODEL.md → events → "Allowed event names". The test enforces it. */
export const EVENT_NAMES = [
  "signed_up",
  "submission_created",
  "upload_completed",
  "analysis_completed",
  "recommendations_ready",
  "recommendations_viewed",
  "recommendation_selected",
  "recommendation_rejected",
  "all_rejected",
  "more_like_this_requested",
  "paid_offer_viewed",
  "paid_offer_clicked",
  "paid",
  "returned_with_second_submission",
  "pipeline_failed",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export function isEventName(x: unknown): x is EventName {
  return typeof x === "string" && (EVENT_NAMES as readonly string[]).includes(x);
}

/**
 * Writes one row to `events`. Never throws: a failed metric must not fail the
 * creator's request. Errors are logged. Always pass creatorId when known —
 * the funnel counts distinct creators per milestone (I7 ruling).
 */
export async function logEvent(e: {
  name: EventName;
  creatorId?: string | null;
  submissionId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await insertEvent({
      name: e.name,
      creator_id: e.creatorId ?? null,
      submission_id: e.submissionId ?? null,
      metadata: e.metadata ?? null,
    });
  } catch (err) {
    logger.error("logEvent failed", { name: e.name, error: String(err) });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: `Test Files  5 passed`, `Tests  28 passed`. If the DATA_MODEL comparison fails, the list in the doc and in code differ — fix the code list, not the test.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add src/feedback/events.ts tests/feedback
git commit -m "Add event names with logEvent and doc-sync test"
```

---

### Task 0.6: App shell, palette, logo and upload screen placeholder

**Files:**
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `components/Logo.tsx`, `components/UploadForm.tsx`
- Delete: any `app/page.module.css`, `app/favicon.ico` references that create-next-app added to `page.tsx` (keep `favicon.ico` itself)

**Interfaces:**
- Produces: `Logo` (NAMED export, wordmark), `UploadForm` (default export) placeholder that Phase 1 Task 1.4 replaces with the real client component (same file path, same default export name).

- [ ] **Step 1: Write `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --ink: #0f1419;
  --steel-light: #8fa8c8;
  --steel: #5b7190;
  --steel-dark: #2e3a4a;
  --canvas: #f7f8fa;
  --card: #ffffff;
  --muted: #6b7280;
}

html,
body {
  background: var(--canvas);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.steel-gradient {
  background-image: linear-gradient(135deg, var(--steel-light) 0%, var(--steel-dark) 100%);
}

.steel-text {
  background-image: linear-gradient(135deg, var(--steel-light) 0%, var(--steel-dark) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
```

- [ ] **Step 2: Write `components/Logo.tsx`**

```tsx
/** Wordmark. Named export: `import { Logo } from "@/components/Logo"`. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline font-semibold tracking-tight ${className}`} aria-label="Songfit">
      <span className="text-ink">Song</span>
      <span className="steel-text">fit</span>
    </span>
  );
}
```

- [ ] **Step 3: Write `app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Songfit",
  description: "Find the right song for your content, and exactly which part to use.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F7F8FA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Write `components/UploadForm.tsx` (placeholder, replaced in Phase 1)**

```tsx
export default function UploadForm() {
  return (
    <form className="mt-10 flex w-full max-w-md flex-col gap-4" aria-disabled>
      <div className="flex h-44 w-full items-center justify-center rounded-3xl border border-dashed border-steel-light bg-white text-sm text-muted">
        Tap to choose a video
      </div>
      <input
        type="text"
        disabled
        placeholder="What do you want this to feel like? (optional)"
        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base"
      />
      <button
        type="button"
        disabled
        className="steel-gradient w-full rounded-2xl px-6 py-4 text-base font-semibold text-white opacity-60"
      >
        Find my songs
      </button>
      <p className="text-center text-xs text-muted">
        Your video is processed by AI services to find songs and kept so you can come back to your results.
      </p>
    </form>
  );
}
```

- [ ] **Step 5: Write `app/page.tsx`**

```tsx
import { Logo } from "@/components/Logo";
import UploadForm from "@/components/UploadForm";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center px-5 pb-16 pt-10">
      <Logo className="text-2xl" />
      <h1 className="mt-12 text-center text-4xl font-semibold leading-tight tracking-tight">
        Find the right song for your content.
      </h1>
      <p className="mt-4 max-w-sm text-center text-base text-muted">
        Upload your Reel and Songfit will find the songs that fit it best, and exactly which part to use.
      </p>
      <UploadForm />
    </main>
  );
}
```

- [ ] **Step 6: Run the dev server and check the page**

```bash
pnpm dev &
sleep 5
curl -s http://localhost:3000 | grep -o "Find the right song for your content."
curl -s http://localhost:3000 | grep -o "processed by AI services"
kill %1
```

Expected: the first curl prints `Find the right song for your content.` once; the second prints `processed by AI services` once.

Open `http://localhost:3000` in a browser at a 390 px wide viewport: wordmark on top, headline, subline, dashed upload box, disabled input and button, disclosure line, no horizontal scroll.

- [ ] **Step 7: Typecheck, lint, test, commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add app components tailwind.config.ts
git commit -m "Add app shell, palette, logo and upload screen placeholder"
```

---

### Task 0.7: Provider smoke test

**Files:**
- Create: `scripts/smoke.ts`

**Interfaces:**
- Consumes: `callClaude` from `src/shared/anthropic.ts`, `MODELS` from `src/shared/config.ts`, `.env.local` (loaded by `node --env-file`), `ffmpeg-static`, `openai`, `@supabase/supabase-js`.
- Produces: `pnpm smoke` printing one `OK`/`FAIL` line per provider with latency. This is the Phase 0 gate and the first thing to re-run whenever a key changes. It deliberately does not import `src/db/client.ts` (which needs Next's server runtime).

- [ ] **Step 1: Write `scripts/smoke.ts`**

```ts
/* Run: pnpm smoke  (node --env-file=.env.local --import tsx scripts/smoke.ts) */
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { callClaude } from "../src/shared/anthropic";
import { MODELS, env } from "../src/shared/config";

const run = promisify(execFile);

type Check = { name: string; fn: () => Promise<string> };

async function timed(check: Check): Promise<boolean> {
  const t0 = Date.now();
  try {
    const detail = await check.fn();
    console.log(`OK    ${check.name.padEnd(10)} ${Date.now() - t0} ms  ${detail}`);
    return true;
  } catch (e) {
    console.log(`FAIL  ${check.name.padEnd(10)} ${Date.now() - t0} ms  ${(e as Error).message}`);
    return false;
  }
}

const checks: Check[] = [
  {
    name: "claude",
    fn: async () => {
      const text = await callClaude({
        model: MODELS.candidates,
        system: "Reply with exactly one word.",
        user: "Say: ready",
        maxTokens: 10,
      });
      return `reply="${text.trim()}"`;
    },
  },
  {
    name: "whisper",
    fn: async () => {
      if (!ffmpegPath) throw new Error("ffmpeg-static binary missing");
      const dir = await mkdtemp(path.join(os.tmpdir(), "songfit-smoke-"));
      const wav = path.join(dir, "silence.wav");
      try {
        await run(ffmpegPath, ["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", wav]);
        const openai = new OpenAI({ apiKey: env("OPENAI_API_KEY") });
        const res = await openai.audio.transcriptions.create({
          file: createReadStream(wav),
          model: MODELS.whisper,
          response_format: "text",
        });
        return `transcript="${String(res).trim().slice(0, 30)}" (silence, empty is fine)`;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "deezer",
    fn: async () => {
      const q = encodeURIComponent('artist:"The Weeknd" track:"Blinding Lights"');
      const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { title: string; duration: number }[] };
      const hit = json.data?.[0];
      if (!hit) throw new Error("no result");
      return `"${hit.title}" duration=${hit.duration}s`;
    },
  },
  {
    name: "database",
    fn: async () => {
      const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false },
      });
      const { count, error } = await db.from("submissions").select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return `submissions=${count ?? 0}`;
    },
  },
];

const results = await Promise.all(checks.map(timed));
process.exit(results.every(Boolean) ? 0 : 1);
```

- [ ] **Step 2: Run it**

```bash
pnpm smoke
```

Expected (with all keys in `.env.local`):

```
OK    claude     ~800 ms  reply="ready"
OK    whisper    ~1500 ms transcript="" (silence, empty is fine)
OK    deezer     ~300 ms  "Blinding Lights" duration=200s
OK    database   ~200 ms  submissions=0
```

and exit code 0. A `FAIL` line names the provider and the error; fix the key or network and re-run. If keys are not in yet, the claude/whisper/database lines FAIL with "Missing required environment variable" — that is expected until Dylan pastes them, and the phase gate waits on it.

- [ ] **Step 3: Typecheck and commit**

`scripts/` is outside `app/` and `src/` but inside the `tsconfig.json` include glob, so `pnpm typecheck` covers it.

```bash
pnpm typecheck
git add scripts/smoke.ts
git commit -m "Add provider smoke test script"
```

---

### Phase 0 demo check

- [ ] `pnpm typecheck && pnpm test && pnpm build` all pass (this is the phase gate; nothing in Phase 1 starts until it does).
- [ ] `pnpm dev` → `http://localhost:3000` shows the Songfit wordmark, headline "Find the right song for your content.", the placeholder upload form and the disclosure line, correctly at phone width.
- [ ] `node --env-file=.env.local /tmp/check-schema.mjs` (Task 0.3 step 7) prints `ok` for all 11 tables, the `videos` bucket, and `claim_submission_run`.
- [ ] `src/db/types.ts` exists, is committed, and contains `create_submission`, `claim_submission_run`, `anchor_seconds`, `stripe_events`.
- [ ] `pnpm smoke` prints four `OK` lines and exits 0 (requires Dylan's keys in `.env.local`).
- [ ] `.env.example` lists all 14 keys; `.env.local` exists locally and is git-ignored (`git ls-files | grep -c '^.env.local$'` prints `0`).
