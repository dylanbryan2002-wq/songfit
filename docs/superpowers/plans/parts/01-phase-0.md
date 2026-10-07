## Phase 0 — Foundations

**Demo when done:** `pnpm dev` serves the upload screen shell with the headline; local Supabase has every table from `docs/DATA_MODEL.md`; `pnpm db:types` produces `src/db/types.ts`; `pnpm typecheck` and `pnpm test` pass.

Notes for the implementer:
- Two columns are added to `candidates` beyond the current `docs/DATA_MODEL.md` because the engine types require them: `direction` (the `DirectionTag`) and `artwork_url`, `deezer_url`, `preview_url` (carried from `VerifiedCandidate` so `recommendations` can be built from candidate rows). Task 0.3 step 1 updates the doc first, per CLAUDE.md.
- `src/db/client.ts` imports `next/headers`, so the browser client lives in its own file `src/db/browser.ts`. Client components import only from `src/db/browser.ts`.
- All `src/db/queries/*` functions use the service-role client and are `server-only`. Ownership checks (is this the caller's submission?) happen in the route/page that calls them. RLS still protects any direct Supabase access from the browser.

---

### Task 0.1: Scaffold the Next.js app

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.gitignore`, `.env.example`, `.eslintrc.json`
- Create (temporary, replaced in Task 0.6): `app/layout.tsx`, `app/page.tsx`, `app/globals.css`

**Interfaces:**
- Produces: the `@/*` path alias mapping to the repo root (so `@/src/shared/types` resolves), the scripts every later task runs (`pnpm typecheck`, `pnpm test`, `pnpm db:types`, `pnpm db:reset`).

- [ ] **Step 1: Scaffold with create-next-app into the current folder**

Run from `/Users/dylanbryan/Songfit` (the folder already has `CLAUDE.md`, `README.md`, `docs/`; create-next-app accepts a non-empty dir only when it contains no conflicting files — these do not conflict):

```bash
pnpm create next-app@latest . --ts --eslint --app --no-src-dir --no-tailwind --import-alias "@/*" --use-pnpm --yes
```

Expected: `Success! Created songfit at /Users/dylanbryan/Songfit`. The folder now contains `app/`, `public/`, `next.config.ts`, `tsconfig.json`, `package.json`, `.gitignore`, `.eslintrc.json` (or `eslint.config.mjs`), `next-env.d.ts`.

If create-next-app refuses because of `README.md`, run it in a temp dir and move everything except `README.md` back:

```bash
pnpm create next-app@latest /tmp/songfit-scaffold --ts --eslint --app --no-src-dir --no-tailwind --import-alias "@/*" --use-pnpm --yes
rsync -a --exclude README.md --exclude .git /tmp/songfit-scaffold/ /Users/dylanbryan/Songfit/
```

- [ ] **Step 2: Install runtime and dev dependencies**

```bash
pnpm add next react react-dom @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk openai zod ffmpeg-static ffprobe-static stripe
pnpm add -D typescript vitest @types/node @types/react @types/react-dom tailwindcss@3 postcss autoprefixer eslint eslint-config-next
```

Expected: `pnpm-lock.yaml` updated, no peer-dependency errors. `ffmpeg-static` downloads a binary on install (~70 MB); if the download fails behind a proxy, re-run `pnpm install`.

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
    "db:types": "supabase gen types typescript --local > src/db/types.ts",
    "db:reset": "supabase db reset"
  }
}
```

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
  experimental: {
    serverComponentsExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net" },
      { protocol: "https", hostname: "cdn-images.dzcdn.net" },
      { protocol: "https", hostname: "is1-ssl.mzstatic.com" },
      { protocol: "https", hostname: "**.mzstatic.com" },
    ],
  },
};

export default nextConfig;
```

If `next build` warns that `serverComponentsExternalPackages` moved to top-level `serverExternalPackages` (Next 15+), move it to `serverExternalPackages: ["ffmpeg-static", "ffprobe-static"]` at the top level.

- [ ] **Step 7: Write `.env.example`**

```bash
# Supabase (Project Settings → API)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Models
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PAYMENT_LINK_URL=https://buy.stripe.com/replace-me

# App
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ADMIN_EMAILS=dylanbryan2002@gmail.com
```

- [ ] **Step 8: Write `.gitignore`**

Append to the scaffolded `.gitignore` (keep what create-next-app wrote):

```
# env
.env
.env.local
.env.*.local

# supabase local
supabase/.branches
supabase/.temp

# media scratch
tmp/
```

- [ ] **Step 9: Verify typecheck and build run**

```bash
pnpm typecheck
pnpm build
```

Expected: `pnpm typecheck` exits 0 with no output. `pnpm build` prints the route table with `○ /` and exits 0.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app with Tailwind, scripts and env example"
```

---

### Task 0.2: Shared config, types, errors, logger

**Files:**
- Create: `src/shared/config.ts`, `src/shared/types.ts`, `src/shared/errors.ts`, `src/shared/logger.ts`, `vitest.config.ts`
- Test: `tests/shared/types.test.ts`, `tests/shared/config.test.ts`

**Interfaces:**
- Produces: everything in the "Shared interfaces" block of the header: `VideoAnalysis`, `MusicBrief`, `AnalysisResult`, `DirectionTag`, `DIRECTION_LABEL`, `GeneratedCandidate`, `VerifiedCandidate`, `DIMENSIONS`, `Dimension`, `ComponentScore`, `ComponentScores`, `ScoredCandidate`, `Pick`, `FinalRecommendation`, `SubmissionStatus`; `MODELS`, `LIMITS`, `CONTENT_CATEGORIES`, `env()`; `PipelineError`; `log`.

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": process.cwd(),
    },
  },
});
```

- [ ] **Step 2: Write the failing tests**

`tests/shared/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { VideoAnalysis, MusicBrief, DIRECTION_LABEL } from "@/src/shared/types";

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
import { env, LIMITS, CONTENT_CATEGORIES } from "@/src/shared/config";

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

describe("LIMITS", () => {
  it("keeps section bounds sane", () => {
    expect(LIMITS.sectionMin).toBeLessThan(LIMITS.sectionDefault);
    expect(LIMITS.sectionDefault).toBeLessThan(LIMITS.sectionMax);
    expect(LIMITS.maxDurationSeconds).toBe(180);
  });
  it("has 'other' as a content category", () => {
    expect(CONTENT_CATEGORIES).toContain("other");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm test
```

Expected: FAIL with `Cannot find module '@/src/shared/types'` (and the same for config).

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
  section_reason: z.string(),
  fit_reason: z.string(),
  direction: DirectionTag,
});
export type GeneratedCandidate = z.infer<typeof GeneratedCandidate>;

export const VerifiedCandidate = GeneratedCandidate.extend({
  deezer_id: z.string(),
  duration_seconds: z.number(),
  artwork_url: z.string().nullable(),
  deezer_url: z.string(),
  preview_url: z.string().nullable(),
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
  direction_label: z.string(),
  start_seconds: z.number(),
  end_seconds: z.number(),
});
export type Pick = z.infer<typeof Pick>;

export const FinalRecommendation = Pick.extend({
  explanation: z.string(),
  spotify_url: z.string(),
  itunes_id: z.string().nullable(),
});
export type FinalRecommendation = z.infer<typeof FinalRecommendation>;

export const SubmissionStatus = z.enum(["uploaded", "analyzing", "recommending", "ready", "failed"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;
```

- [ ] **Step 5: Write `src/shared/config.ts`**

```ts
export const MODELS = {
  analysis: "claude-fable-5-1",
  candidates: "claude-fable-5-1",
  scoring: "claude-fable-5-1",
  explain: "claude-sonnet-5-5",
  whisper: "whisper-1",
} as const;

export const LIMITS = {
  maxUploadBytes: 150 * 1024 * 1024,
  maxDurationSeconds: 180,
  maxFrames: 60,
  frameWidth: 512,
  candidatesPerDirection: 25,
  deezerRps: 8,
  sectionMin: 12,
  sectionMax: 20,
  sectionDefault: 15,
  pipelineBudgetMs: 280_000,
} as const;

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

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => write("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
};
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: `Test Files  2 passed`, `Tests  9 passed`.

- [ ] **Step 9: Typecheck and commit**

```bash
pnpm typecheck
git add vitest.config.ts src/shared tests/shared
git commit -m "Add shared config, Zod types, pipeline error and logger"
```

---

### Task 0.3: Supabase local project and migrations

**Files:**
- Modify: `docs/DATA_MODEL.md` (add `direction`, `artwork_url`, `deezer_url`, `preview_url` to candidates)
- Create: `supabase/config.toml` (generated by `supabase init`, then edited), `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_catalog.sql`, `supabase/migrations/0003_rls.sql`
- Create (generated): `src/db/types.ts`

**Interfaces:**
- Produces: every table in `docs/DATA_MODEL.md`, the `videos` storage bucket, and the generated `Database` type in `src/db/types.ts` that Task 0.4 imports.

- [ ] **Step 1: Update `docs/DATA_MODEL.md` candidates table**

In the `## candidates` table, add these rows after `generator_reason`:

```markdown
| direction         | text        | safe / current / unexpected (DirectionTag)         |
| artwork_url       | text        | nullable, from Deezer                              |
| deezer_url        | text        | nullable, from Deezer                              |
| preview_url       | text        | nullable, 30s Deezer preview                       |
```

- [ ] **Step 2: Install the Supabase CLI and init**

```bash
brew install supabase/tap/supabase   # or: npx supabase@latest --version to use npx
supabase init
```

Expected: `Finished supabase init.` and a new `supabase/config.toml`. (If `brew` is unavailable, prefix every `supabase` command below with `npx supabase@latest`.)

- [ ] **Step 3: Configure Google auth in `supabase/config.toml`**

Find the `[auth.external.google]` block (or add it) and set:

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
redirect_uri = ""
skip_nonce_check = true
```

Also under `[auth]` set:

```toml
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback", "https://thissongfits.com/auth/callback"]
```

Add to `.env.example`:

```bash
# Supabase local Google provider (hosted project sets these in the dashboard)
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=
```

- [ ] **Step 4: Write `supabase/migrations/0001_init.sql`**

```sql
-- Songfit core tables. See docs/DATA_MODEL.md.
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
  created_at timestamptz not null default now()
);
create index submissions_creator_id_idx on public.submissions (creator_id);
create index submissions_status_idx on public.submissions (status);
create index submissions_created_at_idx on public.submissions (created_at desc);

-- video_analyses -----------------------------------------------------------
create table public.video_analyses (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  summary text not null,
  content_type text not null,
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
  song_id uuid, -- FK to songs added in 0002_catalog.sql
  title text not null,
  artist text not null,
  deezer_id text,
  itunes_id text,
  duration_seconds numeric,
  verified boolean not null default false,
  proposed_start numeric not null,
  proposed_end numeric not null,
  generator_reason text not null,
  direction text not null check (direction in ('safe', 'current', 'unexpected')),
  artwork_url text,
  deezer_url text,
  preview_url text,
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
create index events_created_at_idx on public.events (created_at desc);

-- subscriptions ------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  status text not null check (status in ('active', 'canceled', 'past_due')),
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index subscriptions_creator_id_idx on public.subscriptions (creator_id);
create unique index subscriptions_stripe_subscription_id_idx
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- storage ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('videos', 'videos', false, 157286400)
on conflict (id) do nothing;
```

- [ ] **Step 5: Write `supabase/migrations/0002_catalog.sql`**

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
```

- [ ] **Step 6: Write `supabase/migrations/0003_rls.sql`**

```sql
-- Row Level Security. Creators see only their own rows. Tables with no
-- policies are service-role only (the service role bypasses RLS).

alter table public.creators enable row level security;
create policy "creators: read own" on public.creators
  for select to authenticated using (auth.uid() = id);
create policy "creators: update own" on public.creators
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

alter table public.submissions enable row level security;
create policy "submissions: read own" on public.submissions
  for select to authenticated using (auth.uid() = creator_id);
create policy "submissions: insert own" on public.submissions
  for insert to authenticated with check (auth.uid() = creator_id);

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

alter table public.songs enable row level security;
alter table public.song_segments enable row level security;
alter table public.song_trend_signals enable row level security;
-- no policies: service role only

-- Storage: creators upload to and read from their own folder in `videos`.
create policy "videos: upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "videos: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 7: Start local Supabase and apply migrations**

```bash
supabase start
pnpm db:reset
```

Expected: `supabase start` prints `API URL: http://127.0.0.1:54321`, `anon key: ...`, `service_role key: ...`. `pnpm db:reset` prints `Applying migration 0001_init.sql`, `0002_catalog.sql`, `0003_rls.sql` and `Finished supabase db reset`.

Copy the printed anon and service_role keys into `.env.local` (create it from `.env.example`).

- [ ] **Step 8: Verify the tables exist**

```bash
supabase db query "select table_name from information_schema.tables where table_schema = 'public' order by 1"
```

(If that subcommand is unavailable in your CLI version, use `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\dt public.*"`.)

Expected rows: `candidates, creators, events, recommendations, song_segments, song_trend_signals, songs, submissions, subscriptions, video_analyses`.

```bash
supabase db query "select id, public, file_size_limit from storage.buckets"
```

Expected: one row `videos | false | 157286400`.

- [ ] **Step 9: Generate database types**

```bash
mkdir -p src/db
pnpm db:types
head -5 src/db/types.ts
```

Expected: file begins with `export type Json =` and contains `candidates: { Row: {` further down.

- [ ] **Step 10: Commit**

```bash
pnpm typecheck
git add docs/DATA_MODEL.md supabase src/db/types.ts .env.example
git commit -m "Add Supabase config, core and catalog migrations, RLS and generated types"
```

---

### Task 0.4: Database clients and typed queries

**Files:**
- Create: `src/db/client.ts`, `src/db/browser.ts`, `src/db/queries/creators.ts`, `src/db/queries/submissions.ts`, `src/db/queries/analyses.ts`, `src/db/queries/candidates.ts`, `src/db/queries/recommendations.ts`, `src/db/queries/events.ts`, `src/db/queries/subscriptions.ts`

**Interfaces:**
- Consumes: `Database` from `src/db/types.ts` (Task 0.3); `env()` from `src/shared/config.ts` (Task 0.2); `SubmissionStatus` from `src/shared/types.ts`.
- Produces:
  - `createServerClient(): Promise<SupabaseClient<Database>>`, `createServiceClient(): SupabaseClient<Database>` (in `client.ts`); `createBrowserClient(): SupabaseClient<Database>` (in `browser.ts`).
  - `ensureCreator(id, email, displayName?)`, `getCreatorByEmail(email)`, `getCreator(id)`
  - `getSubmission(id)`, `createSubmission({ creatorId, videoPath, creatorIntent })`, `setSubmissionStatus(id, status, error?)`, `setSubmissionAnalyzed(id, { durationSeconds, contentCategory })`, `markSubmissionViewed(id)`, `listSubmissions(limit?)`, `countSubmissionsForCreator(creatorId)`
  - `upsertAnalysis(row)`, `getAnalysis(submissionId)`
  - `replaceCandidates(submissionId, rows)`, `listCandidates(submissionId)`
  - `replaceRecommendations(submissionId, rows)`, `listRecommendations(submissionId)`
  - `insertEvent(row)`, `listEventsForSubmission(submissionId)`, `countEventsByName()`
  - `getActiveSubscription(creatorId)`, `activateSubscription({ creatorId, stripeCustomerId, stripeSubscriptionId })`, `setSubscriptionStatus(stripeSubscriptionId, status)`
  - Row type aliases: `SubmissionRow`, `AnalysisRow`, `CandidateRow`, `RecommendationRow`, `EventRow`, `SubscriptionRow`, `CreatorRow`, and `Insert` variants.

No unit tests in this task: every function is a thin typed wrapper over Supabase with no logic. Verified by `pnpm typecheck` against the generated `Database` type, and exercised end to end in Phase 1.

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

Install the `server-only` package so the import guard works:

```bash
pnpm add server-only
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

export type SubmissionRow = Database["public"]["Tables"]["submissions"]["Row"];

export async function getSubmission(id: string): Promise<SubmissionRow | null> {
  const { data, error } = await createServiceClient().from("submissions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createSubmission(input: {
  creatorId: string;
  videoPath: string;
  creatorIntent: string | null;
}): Promise<SubmissionRow> {
  const { data, error } = await createServiceClient()
    .from("submissions")
    .insert({
      creator_id: input.creatorId,
      video_path: input.videoPath,
      creator_intent: input.creatorIntent,
      status: "uploaded",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setSubmissionStatus(
  id: string,
  status: SubmissionStatus,
  error?: string | null,
): Promise<void> {
  const patch: Database["public"]["Tables"]["submissions"]["Update"] = { status, error: error ?? null };
  if (status === "ready") patch.recommended_at = new Date().toISOString();
  const { error: dbError } = await createServiceClient().from("submissions").update(patch).eq("id", id);
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

/** Paywall input: how many finished results this creator already has. */
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
import { VideoAnalysis, MusicBrief } from "../../shared/types";

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

/** Idempotent per stage run: deletes the submission's candidates and inserts the new set. */
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

/** Idempotent on stripe_subscription_id. */
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

- [ ] **Step 10: Typecheck and commit**

```bash
pnpm typecheck
```

Expected: exit 0. If `upsert(..., { onConflict: "stripe_subscription_id" })` fails typecheck because the partial unique index is not a constraint, change the migration: replace the partial unique index in `0001_init.sql` with a plain `unique (stripe_subscription_id)` column constraint (NULLs are allowed to repeat under a unique constraint), run `pnpm db:reset && pnpm db:types`, and re-run typecheck.

```bash
git add src/db package.json pnpm-lock.yaml
git commit -m "Add Supabase clients and typed query functions"
```

---

### Task 0.5: Event names and `logEvent`

**Files:**
- Create: `src/feedback/events.ts`
- Test: `tests/feedback/events.test.ts`

**Interfaces:**
- Consumes: `insertEvent` from `src/db/queries/events.ts` (Task 0.4).
- Produces: `EVENT_NAMES`, `EventName`, `isEventName(x): x is EventName`, `logEvent({ name, creatorId?, submissionId?, metadata? })`.

- [ ] **Step 1: Write the failing test**

`tests/feedback/events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EVENT_NAMES, isEventName } from "@/src/feedback/events";

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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/feedback
```

Expected: FAIL with `Cannot find module '@/src/feedback/events'`.

- [ ] **Step 3: Write `src/feedback/events.ts`**

```ts
import { insertEvent } from "@/src/db/queries/events";
import { log } from "@/src/shared/logger";

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
 * creator's request. Errors are logged.
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
    log.error("logEvent failed", { name: e.name, error: String(err) });
  }
}
```

The test file imports `events.ts`, which imports `src/db/queries/events.ts`, which imports `server-only`. Vitest does not run in a Next server context, so `server-only` throws on import. Add this alias to `vitest.config.ts` so the guard is a no-op in tests:

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
      "server-only": path.join(process.cwd(), "tests", "stubs", "server-only.ts"),
    },
  },
});
```

And create `tests/stubs/server-only.ts`:

```ts
// Vitest stub: the real package throws outside Next's server runtime.
export {};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: `Test Files  3 passed`, all tests green. If the DATA_MODEL comparison fails, the list in the doc and in code differ — fix the code list, not the test.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add src/feedback/events.ts tests/feedback tests/stubs vitest.config.ts
git commit -m "Add event names with logEvent and doc-sync test"
```

---

### Task 0.6: App shell, palette, logo and upload screen placeholder

**Files:**
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `components/Logo.tsx`, `components/UploadForm.tsx`
- Delete: any `app/page.module.css`, `app/favicon.ico` references that create-next-app added to `page.tsx` (keep `favicon.ico` itself)

**Interfaces:**
- Produces: `<Logo />` (wordmark), `<UploadForm />` placeholder that Phase 1 Task 1.x replaces with the real client component (same file path, same default export name `UploadForm`).

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
export default function Logo({ className = "" }: { className?: string }) {
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
    </form>
  );
}
```

- [ ] **Step 5: Write `app/page.tsx`**

```tsx
import Logo from "@/components/Logo";
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

Add `muted` to the Tailwind palette so `text-muted` resolves. In `tailwind.config.ts` `colors`, add `muted: "#6B7280"`.

- [ ] **Step 6: Run the dev server and check the page**

```bash
pnpm dev &
sleep 5
curl -s http://localhost:3000 | grep -o "Find the right song for your content."
kill %1
```

Expected: the curl prints `Find the right song for your content.` once.

Open `http://localhost:3000` in a browser at a 390 px wide viewport: wordmark on top, headline, subline, dashed upload box, disabled input and button, no horizontal scroll.

- [ ] **Step 7: Typecheck, lint, test, commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add app components tailwind.config.ts
git commit -m "Add app shell, palette, logo and upload screen placeholder"
```

---

### Phase 0 demo check

- [ ] `pnpm dev` → `http://localhost:3000` shows the Songfit wordmark, headline "Find the right song for your content." and the placeholder upload form, correctly at phone width.
- [ ] `supabase status` shows the local stack running; `supabase db query "select count(*) from information_schema.tables where table_schema='public'"` returns `10`.
- [ ] `storage.buckets` contains `videos`, private, 150 MB limit.
- [ ] `src/db/types.ts` exists, is committed, and `pnpm typecheck` passes.
- [ ] `pnpm test` passes: schema tests, env tests, event-name sync test.
- [ ] `.env.example` lists every key; `.env.local` exists locally and is git-ignored.
- [ ] `git log --oneline` shows six commits for Tasks 0.1–0.6.
