## Phase 3 — Engine → results

**Demo when done:** upload a real video → about 90 s later the results page shows 3 real songs with sections, reasons and playable previews; the admin inspector shows ~60 scored candidates.

Tasks are ordered by dependency: normalisation first (everything matches on it), then candidates, catalog, scoring, diversify, sections, explain, the orchestrator, and finally UI.

Conventions for every task in this phase:
- Imports use the `@/` alias (`@/src/shared/types`), which Next.js maps to the repo root.
- Model calls go through `callClaude` from `src/shared/anthropic.ts` (created in Phase 2, Task 2.3b). Its signature, which every stage depends on:
  ```ts
  export type ClaudeCall = (args: { model: string; system: string; user: string; maxTokens?: number }) => Promise<string>;
  export const callClaude: ClaudeCall;
  ```
  Each model-backed stage takes an optional `deps` argument so tests inject a stub instead of mocking modules.
- `extractJson(text: string): unknown` from `src/shared/json.ts` (Phase 2, Task 2.3) strips code fences and returns the first JSON value found. Stages call `extractJson` then Zod.
- `PipelineError` from `src/shared/errors.ts` (Phase 0): `new PipelineError(stage: string, message: string, raw?: string)`.
- Tests live in `tests/` mirroring `src/`, run with `pnpm test -- <path>`.

---

### Task 3.1: Title and artist normalisation

**Files:**
- Create: `src/engine/catalog/normalize.ts`
- Test: `tests/engine/catalog/normalize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export function normalizeTitle(s: string): string;
  export function normalizeArtist(s: string): string;   // primary artist only
  export function normalizeKey(title: string, artist: string): string; // `${title}|${artist}`
  export function titlesMatch(a: string, b: string): boolean;
  export function artistsMatch(a: string, b: string): boolean;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/catalog/normalize.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeTitle, normalizeArtist, normalizeKey, titlesMatch, artistsMatch,
} from "@/src/engine/catalog/normalize";

describe("normalizeTitle", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeTitle("Don't Stop Me Now!")).toBe("don t stop me now");
  });
  it("strips diacritics", () => {
    expect(normalizeTitle("Señorita")).toBe("senorita");
  });
  it("removes bracketed suffixes", () => {
    expect(normalizeTitle("Blinding Lights (feat. Rosalía) [Remastered]")).toBe("blinding lights");
  });
  it("removes dash suffixes", () => {
    expect(normalizeTitle("Blinding Lights - Radio Edit")).toBe("blinding lights");
    expect(normalizeTitle("Running Up That Hill - From Stranger Things")).toBe("running up that hill");
  });
  it("removes feat clauses without brackets", () => {
    expect(normalizeTitle("Industry Baby feat. Jack Harlow")).toBe("industry baby");
  });
});

describe("normalizeArtist", () => {
  it("keeps the primary artist", () => {
    expect(normalizeArtist("Drake feat. Rihanna")).toBe("drake");
    expect(normalizeArtist("Lady Gaga & Bruno Mars")).toBe("lady gaga");
    expect(normalizeArtist("Jawsh 685, Jason Derulo")).toBe("jawsh 685");
    expect(normalizeArtist("Fred again.. x Skepta")).toBe("fred again");
  });
  it("strips diacritics", () => {
    expect(normalizeArtist("Beyoncé")).toBe("beyonce");
  });
});

describe("matching", () => {
  it("titlesMatch tolerates edits", () => {
    expect(titlesMatch("Blinding Lights", "Blinding Lights - Radio Edit")).toBe(true);
    expect(titlesMatch("Blinding Lights", "Blinding Lights (Live)")).toBe(true);
    expect(titlesMatch("Blinding Lights", "Save Your Tears")).toBe(false);
  });
  it("artistsMatch compares primary artists", () => {
    expect(artistsMatch("Beyoncé", "Beyonce")).toBe(true);
    expect(artistsMatch("Drake feat. Rihanna", "Drake")).toBe(true);
    expect(artistsMatch("Drake", "Rihanna")).toBe(false);
  });
  it("normalizeKey combines both", () => {
    expect(normalizeKey("Blinding Lights - Radio Edit", "The Weeknd")).toBe("blinding lights|the weeknd");
  });
  it("empty strings never match", () => {
    expect(titlesMatch("", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/catalog/normalize.test.ts`
Expected: FAIL, "Cannot find module '@/src/engine/catalog/normalize'".

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/normalize.ts
// Loose string matching so a model-proposed "Blinding Lights" matches Deezer's
// "Blinding Lights - Radio Edit". Both sides always go through the same function.

const BRACKET_SUFFIX_RE = /\s*[(\[][^)\]]*[)\]]/g;                  // "(feat. X)", "[Remastered]"
const DASH_SUFFIX_RE = /\s+-\s+.*$/;                                 // " - Radio Edit", " - From …"
const FEAT_RE = /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i;             // "feat. Jack Harlow"
const ARTIST_SPLIT_RE = /\s+(?:feat\.?|ft\.?|featuring|&|x|with|and)\s+|\s*,\s*/i;

function base(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function squash(s: string): string {
  return s.replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeTitle(s: string): string {
  return squash(
    base(s).replace(BRACKET_SUFFIX_RE, "").replace(DASH_SUFFIX_RE, "").replace(FEAT_RE, ""),
  );
}

export function normalizeArtist(s: string): string {
  const primary = base(s).replace(BRACKET_SUFFIX_RE, "").split(ARTIST_SPLIT_RE)[0] ?? "";
  return squash(primary);
}

export function normalizeKey(title: string, artist: string): string {
  return `${normalizeTitle(title)}|${normalizeArtist(artist)}`;
}

export function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

export function artistsMatch(a: string, b: string): boolean {
  const na = normalizeArtist(a);
  const nb = normalizeArtist(b);
  if (!na || !nb) return false;
  return na === nb;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/catalog/normalize.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/normalize.ts tests/engine/catalog/normalize.test.ts
git commit -m "Add title and artist normalisation for song matching"
```

---

### Task 3.2: Candidate generation (three directions, deduplicated)

**Files:**
- Create: `src/engine/candidates/generateCandidates.ts`
- Test: `tests/engine/candidates/generateCandidates.test.ts`

**Interfaces:**
- Consumes: `MusicBrief`, `VideoAnalysis`, `GeneratedCandidate`, `DirectionTag` from `@/src/shared/types`; `MODELS`, `LIMITS` from `@/src/shared/config`; `callClaude`, `ClaudeCall` from `@/src/shared/anthropic`; `extractJson` from `@/src/shared/json`; `normalizeKey` from Task 3.1.
- Produces:
  ```ts
  export const PROMPT_VERSION = "candidates-v1";
  export function buildCandidatePrompt(direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis, note?: string): string;
  export function parseCandidates(text: string, direction: DirectionTag): GeneratedCandidate[];
  export function dedupeCandidates(cands: GeneratedCandidate[]): GeneratedCandidate[];
  export async function generateCandidates(brief: MusicBrief, analysis: VideoAnalysis, opts?: { note?: string; call?: ClaudeCall }): Promise<GeneratedCandidate[]>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/candidates/generateCandidates.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  dedupeCandidates, parseCandidates, generateCandidates, buildCandidatePrompt,
} from "@/src/engine/candidates/generateCandidates";
import type { GeneratedCandidate, MusicBrief, VideoAnalysis } from "@/src/shared/types";

const cand = (over: Partial<GeneratedCandidate>): GeneratedCandidate => ({
  title: "Blinding Lights", artist: "The Weeknd", proposed_start: 43, proposed_end: 58,
  section_reason: "chorus entry", fit_reason: "fits the night drive", direction: "safe", ...over,
});

export const analysis: VideoAnalysis = {
  summary: "Creator walks through NYC at night and reveals an outfit.",
  content_type: "fashion lifestyle reel", content_category: "fashion",
  setting: "New York at night", story: "walk then reveal",
  aesthetic: ["luxury", "urban"], mood: ["confident", "mysterious"],
  energy: "medium-high", pacing: "medium", dialogue_present: false,
  important_moments: [{ time: 7.8, type: "main_visual_reveal", note: "outfit reveal" }],
};

export const brief: MusicBrief = {
  text: "Modern NYC fashion montage. Confident and slightly mysterious. Needs a lift around 8 s.",
  fields: {
    moods: ["confident", "cool"], energy: 0.72, tempo_preference: "medium-high",
    vocal_preference: "either", genre_preferences: [], genre_avoid: [],
    dialogue_present: false, desired_cultural_relevance: "high",
    desired_familiarity: "recognizable_not_overused",
  },
};

describe("dedupeCandidates", () => {
  it("keeps the first occurrence, ignoring case and punctuation", () => {
    const out = dedupeCandidates([
      cand({ title: "Blinding Lights", direction: "safe" }),
      cand({ title: "blinding lights - radio edit", direction: "current" }),
      cand({ title: "Save Your Tears", direction: "current" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.direction).toBe("safe");
    expect(out[1]!.title).toBe("Save Your Tears");
  });
});

describe("parseCandidates", () => {
  it("drops malformed items and keeps the rest, forcing the direction", () => {
    const text = "```json\n" + JSON.stringify([
      { title: "A", artist: "B", proposed_start: 10, proposed_end: 25, section_reason: "x", fit_reason: "y", direction: "safe" },
      { title: "Bad", artist: "C" },
      { title: "D", artist: "E", proposed_start: "30", proposed_end: 45, section_reason: "x", fit_reason: "y" },
    ]) + "\n```";
    const out = parseCandidates(text, "unexpected");
    expect(out.map((c) => c.title)).toEqual(["A"]);
    expect(out[0]!.direction).toBe("unexpected");
  });
  it("throws when no JSON array is present", () => {
    expect(() => parseCandidates("sorry, no", "safe")).toThrow(/candidates/);
  });
});

describe("generateCandidates", () => {
  it("makes three calls and merges results", async () => {
    const call = vi.fn(async ({ user }: { user: string }) => {
      const dir = user.includes("DIRECTION: safe") ? "safe" : user.includes("DIRECTION: current") ? "current" : "unexpected";
      return JSON.stringify([
        { title: `${dir} song`, artist: "X", proposed_start: 10, proposed_end: 25, section_reason: "s", fit_reason: "f", direction: dir },
        { title: "Shared Song", artist: "Y", proposed_start: 10, proposed_end: 25, section_reason: "s", fit_reason: "f", direction: dir },
      ]);
    });
    const out = await generateCandidates(brief, analysis, { call });
    expect(call).toHaveBeenCalledTimes(3);
    expect(out.map((c) => c.title).sort()).toEqual(["Shared Song", "current song", "safe song", "unexpected song"]);
  });
  it("includes the note when given", () => {
    expect(buildCandidatePrompt("safe", brief, analysis, "avoid previous list")).toContain("avoid previous list");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/candidates/generateCandidates.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/candidates/generateCandidates.ts
import { z } from "zod";
import {
  GeneratedCandidate, DirectionTag, type MusicBrief, type VideoAnalysis,
} from "@/src/shared/types";
import { MODELS, LIMITS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { PipelineError } from "@/src/shared/errors";
import { normalizeKey } from "@/src/engine/catalog/normalize";

export const PROMPT_VERSION = "candidates-v1";

const SYSTEM = `You are Songfit's music supervisor for short-form video (Instagram Reels, TikTok).
You know mainstream, independent and viral music across decades, and you know which songs
creators actually use on these platforms. You only ever name REAL, officially released songs by
the original artist that are very likely available in the Instagram and TikTok music libraries
in the United States. Never invent songs. Never suggest AI-generated music, unreleased tracks,
remixes by unknown accounts, or production-library stock music. Prefer the original artist's
version over covers and sped-up edits.`;

const DIRECTION_BRIEF: Record<DirectionTag, string> = {
  safe: "Recognisable, proven fits for this kind of content: songs a creator in this niche has seen work many times. Mainstream enough to be in both libraries.",
  current: "Popular on Instagram Reels and TikTok within the last 12 months, or trending-adjacent: artists and songs having a moment right now. Still real, released and easy to find.",
  unexpected: "Less obvious: older songs, niche genres, deep cuts from known artists, genre-crossing picks that a tasteful editor would reach for. Must still be real, released and findable in the libraries.",
};

export function buildCandidatePrompt(
  direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis, note?: string,
): string {
  const moments = analysis.important_moments
    .map((m) => `- ${m.time.toFixed(1)}s: ${m.type}${m.note ? ` (${m.note})` : ""}`)
    .join("\n") || "- none identified";
  return `DIRECTION: ${direction}
${DIRECTION_BRIEF[direction]}

VIDEO
${analysis.summary}
Content type: ${analysis.content_type} (${analysis.content_category})
Setting: ${analysis.setting ?? "unknown"}
Story: ${analysis.story ?? "none"}
Aesthetic: ${analysis.aesthetic.join(", ")}
Mood: ${analysis.mood.join(", ")}
Energy: ${analysis.energy}. Pacing: ${analysis.pacing}.
Spoken dialogue present: ${analysis.dialogue_present ? "YES, vocals may fight the speech" : "no"}
Key moments:
${moments}

MUSIC BRIEF
${brief.text}
Fields: ${JSON.stringify(brief.fields)}
${note ? `\nNOTE: ${note}\n` : ""}
TASK
Propose exactly ${LIMITS.candidatesPerDirection} songs for this direction. For each song choose the single
best ${LIMITS.sectionMin}–${LIMITS.sectionMax} second window of the ORIGINAL recording for this video:
usually the chorus entry, the drop, or the moment the energy lifts. proposed_start is the second where
that musical moment begins; proposed_end is proposed_start plus the window length.

Return ONLY a JSON array, no prose, each item exactly:
{
  "title": string,
  "artist": string,
  "proposed_start": number,   // seconds into the song
  "proposed_end": number,     // seconds into the song
  "section_reason": string,   // what happens musically in that window (one sentence)
  "fit_reason": string,       // why it fits THIS video, referencing something specific in it (one sentence)
  "direction": "${direction}"
}`;
}

const ItemArray = z.array(z.unknown());

export function parseCandidates(text: string, direction: DirectionTag): GeneratedCandidate[] {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    throw new PipelineError("recommend", `candidates: no JSON in model output (${direction})`, text);
  }
  const arr = ItemArray.safeParse(raw);
  if (!arr.success) {
    throw new PipelineError("recommend", `candidates: output is not an array (${direction})`, text);
  }
  const out: GeneratedCandidate[] = [];
  for (const item of arr.data) {
    const parsed = GeneratedCandidate.safeParse({ ...(item as object), direction });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function dedupeCandidates(cands: GeneratedCandidate[]): GeneratedCandidate[] {
  const seen = new Set<string>();
  const out: GeneratedCandidate[] = [];
  for (const c of cands) {
    const key = normalizeKey(c.title, c.artist);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export async function generateCandidates(
  brief: MusicBrief,
  analysis: VideoAnalysis,
  opts: { note?: string; call?: ClaudeCall } = {},
): Promise<GeneratedCandidate[]> {
  const call = opts.call ?? callClaude;
  const lists = await Promise.all(
    DirectionTag.options.map(async (direction) => {
      const text = await call({
        model: MODELS.candidates,
        system: SYSTEM,
        user: buildCandidatePrompt(direction, brief, analysis, opts.note),
        maxTokens: 6000,
      });
      return parseCandidates(text, direction);
    }),
  );
  return dedupeCandidates(lists.flat());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/candidates/generateCandidates.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/candidates tests/engine/candidates
git commit -m "Add three-direction candidate generation with dedupe"
```

---

### Task 3.3: Deezer search, throttle and match

**Files:**
- Create: `src/engine/catalog/deezer.ts`
- Test: `tests/engine/catalog/deezer.test.ts`

**Interfaces:**
- Consumes: `LIMITS.deezerRps`; `titlesMatch`, `artistsMatch` from Task 3.1.
- Produces:
  ```ts
  export type DeezerTrack = { id: number; title: string; duration: number; preview: string | null; link: string; artist: { name: string }; album?: { cover_medium?: string | null; cover_big?: string | null } };
  export function createThrottle(rps: number): () => Promise<void>;
  export const deezerThrottle: () => Promise<void>;
  export async function searchDeezer(title: string, artist: string, fetchImpl?: typeof fetch): Promise<DeezerTrack[]>;
  export function pickDeezerMatch(cand: { title: string; artist: string }, results: DeezerTrack[]): DeezerTrack | null;
  export async function findDeezerMatch(cand: { title: string; artist: string }, fetchImpl?: typeof fetch): Promise<DeezerTrack | null>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/catalog/deezer.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createThrottle, pickDeezerMatch, searchDeezer, type DeezerTrack,
} from "@/src/engine/catalog/deezer";

const track = (over: Partial<DeezerTrack>): DeezerTrack => ({
  id: 1, title: "Blinding Lights", duration: 200, preview: "https://p/1.mp3",
  link: "https://www.deezer.com/track/1", artist: { name: "The Weeknd" },
  album: { cover_medium: "m.jpg", cover_big: "b.jpg" }, ...over,
});

afterEach(() => vi.useRealTimers());

describe("createThrottle", () => {
  it("spaces calls at 1000/rps ms", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const wait = createThrottle(8);
    const done: number[] = [];
    const p = Promise.all([0, 1, 2].map(() => wait().then(() => done.push(Date.now()))));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toEqual([0]);
    await vi.advanceTimersByTimeAsync(125);
    expect(done).toEqual([0, 125]);
    await vi.advanceTimersByTimeAsync(125);
    await p;
    expect(done).toEqual([0, 125, 250]);
  });
});

describe("pickDeezerMatch", () => {
  it("returns the first result whose title and primary artist match", () => {
    const results = [
      track({ id: 9, title: "Blinding Lights", artist: { name: "Karaoke Hits" } }),
      track({ id: 2, title: "Blinding Lights - Radio Edit", artist: { name: "The Weeknd" } }),
    ];
    expect(pickDeezerMatch({ title: "Blinding Lights", artist: "The Weeknd" }, results)?.id).toBe(2);
  });
  it("returns null when nothing matches", () => {
    expect(pickDeezerMatch({ title: "Nope", artist: "Nobody" }, [track({})])).toBeNull();
  });
});

describe("searchDeezer", () => {
  it("falls back to a plain query when the strict one is empty", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const data = u.includes("artist%3A") ? [] : [track({})];
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    const out = await searchDeezer("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out[0]!.id).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/catalog/deezer.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/deezer.ts
// Deezer's public search API: no auth, ~50 requests / 5 s per IP. See docs/RESEARCH.md.
import { z } from "zod";
import { LIMITS } from "@/src/shared/config";
import { titlesMatch, artistsMatch } from "@/src/engine/catalog/normalize";

const DeezerTrackSchema = z.object({
  id: z.number(),
  title: z.string(),
  duration: z.number(),
  preview: z.string().nullable().optional().transform((v) => v || null),
  link: z.string(),
  artist: z.object({ name: z.string() }),
  album: z
    .object({
      cover_medium: z.string().nullable().optional(),
      cover_big: z.string().nullable().optional(),
    })
    .optional(),
});
const DeezerSearchSchema = z.object({ data: z.array(DeezerTrackSchema).default([]) });
export type DeezerTrack = z.infer<typeof DeezerTrackSchema>;

/** Simple pacing throttle: callers await it before each request; calls are spaced 1000/rps ms apart. */
export function createThrottle(rps: number): () => Promise<void> {
  const interval = 1000 / rps;
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + interval;
    if (at > now) await new Promise<void>((r) => setTimeout(r, at - now));
  };
}

export const deezerThrottle = createThrottle(LIMITS.deezerRps);

async function query(q: string, fetchImpl: typeof fetch): Promise<DeezerTrack[]> {
  await deezerThrottle();
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`;
  const res = await fetchImpl(url);
  if (!res.ok) return [];
  const parsed = DeezerSearchSchema.safeParse(await res.json());
  return parsed.success ? parsed.data.data : [];
}

export async function searchDeezer(
  title: string, artist: string, fetchImpl: typeof fetch = fetch,
): Promise<DeezerTrack[]> {
  const strict = await query(`artist:"${artist}" track:"${title}"`, fetchImpl);
  if (strict.length > 0) return strict;
  return query(`${title} ${artist}`, fetchImpl);
}

export function pickDeezerMatch(
  cand: { title: string; artist: string }, results: DeezerTrack[],
): DeezerTrack | null {
  for (const r of results) {
    if (titlesMatch(cand.title, r.title) && artistsMatch(cand.artist, r.artist.name)) return r;
  }
  return null;
}

export async function findDeezerMatch(
  cand: { title: string; artist: string }, fetchImpl: typeof fetch = fetch,
): Promise<DeezerTrack | null> {
  try {
    return pickDeezerMatch(cand, await searchDeezer(cand.title, cand.artist, fetchImpl));
  } catch {
    return null; // network failure on one candidate must not fail the stage
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/catalog/deezer.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/deezer.ts tests/engine/catalog/deezer.test.ts
git commit -m "Add Deezer search with throttle and loose matching"
```

---

### Task 3.4: iTunes preview fallback

**Files:**
- Create: `src/engine/catalog/itunes.ts`
- Test: `tests/engine/catalog/itunes.test.ts`

**Interfaces:**
- Consumes: `titlesMatch`, `artistsMatch`.
- Produces: `export async function findItunesPreview(title: string, artist: string, fetchImpl?: typeof fetch): Promise<{ itunesId: string; previewUrl: string | null } | null>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/catalog/itunes.test.ts
import { describe, it, expect, vi } from "vitest";
import { findItunesPreview } from "@/src/engine/catalog/itunes";

const body = {
  results: [
    { trackId: 11, trackName: "Blinding Lights (Karaoke)", artistName: "Karaoke Co", previewUrl: "https://k.m4a" },
    { trackId: 12, trackName: "Blinding Lights", artistName: "The Weeknd", previewUrl: "https://w.m4a" },
  ],
};

describe("findItunesPreview", () => {
  it("returns the matching track's id and preview", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const out = await findItunesPreview("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch);
    expect(out).toEqual({ itunesId: "12", previewUrl: "https://w.m4a" });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("country=US");
  });
  it("returns null on no match or error", async () => {
    const bad = vi.fn(async () => new Response("nope", { status: 403 }));
    expect(await findItunesPreview("X", "Y", bad as unknown as typeof fetch)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/engine/catalog/itunes.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/itunes.ts
// iTunes Search API: free, no auth, ~20 calls/min. Only call for the final 3 picks.
import { z } from "zod";
import { titlesMatch, artistsMatch } from "@/src/engine/catalog/normalize";

const ItunesResult = z.object({
  trackId: z.number(),
  trackName: z.string(),
  artistName: z.string(),
  previewUrl: z.string().optional(),
});
const ItunesSearch = z.object({ results: z.array(ItunesResult).default([]) });

export async function findItunesPreview(
  title: string, artist: string, fetchImpl: typeof fetch = fetch,
): Promise<{ itunesId: string; previewUrl: string | null } | null> {
  try {
    const term = encodeURIComponent(`${title} ${artist}`);
    const res = await fetchImpl(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5&country=US`);
    if (!res.ok) return null;
    const parsed = ItunesSearch.safeParse(await res.json());
    if (!parsed.success) return null;
    const hit = parsed.data.results.find(
      (r) => titlesMatch(title, r.trackName) && artistsMatch(artist, r.artistName),
    );
    return hit ? { itunesId: String(hit.trackId), previewUrl: hit.previewUrl ?? null } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/engine/catalog/itunes.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/itunes.ts tests/engine/catalog/itunes.test.ts
git commit -m "Add iTunes preview lookup for final picks"
```

---

### Task 3.5: Verify candidates against Deezer

**Files:**
- Create: `src/engine/catalog/verifyCandidates.ts`
- Test: `tests/engine/catalog/verifyCandidates.test.ts`

**Interfaces:**
- Consumes: `GeneratedCandidate`, `VerifiedCandidate`; `findDeezerMatch`, `DeezerTrack` (Task 3.3); `LIMITS.sectionMin`, `LIMITS.sectionDefault`.
- Produces:
  ```ts
  export function clampSection(start: number, end: number, duration: number): { start: number; end: number };
  export async function verifyCandidates(cands: GeneratedCandidate[], deps?: { find?: typeof findDeezerMatch }): Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/catalog/verifyCandidates.test.ts
import { describe, it, expect, vi } from "vitest";
import { clampSection, verifyCandidates } from "@/src/engine/catalog/verifyCandidates";
import type { GeneratedCandidate } from "@/src/shared/types";
import type { DeezerTrack } from "@/src/engine/catalog/deezer";

describe("clampSection", () => {
  it("leaves a valid window alone", () => {
    expect(clampSection(43, 58, 200)).toEqual({ start: 43, end: 58 });
  });
  it("clamps end to the track duration", () => {
    expect(clampSection(43, 260, 200)).toEqual({ start: 43, end: 200 });
  });
  it("moves a start too near the end back to a sensible window", () => {
    // 195 >= 200 - 12 → start = 200 - 15 - 5 = 180, end = 195
    expect(clampSection(195, 210, 200)).toEqual({ start: 180, end: 195 });
  });
  it("widens a window shorter than the minimum", () => {
    expect(clampSection(40, 45, 200)).toEqual({ start: 40, end: 55 });
  });
});

const gen = (title: string): GeneratedCandidate => ({
  title, artist: "The Weeknd", proposed_start: 43, proposed_end: 58,
  section_reason: "chorus", fit_reason: "fits", direction: "safe",
});

describe("verifyCandidates", () => {
  it("splits into verified and unverified and attaches Deezer fields", async () => {
    const find = vi.fn(async (c: { title: string }) =>
      c.title === "Found"
        ? ({ id: 7, title: "Found", duration: 200, preview: "https://p.mp3", link: "https://d/7",
            artist: { name: "The Weeknd" }, album: { cover_medium: "m.jpg", cover_big: "b.jpg" } } as DeezerTrack)
        : null,
    );
    const { verified, unverified } = await verifyCandidates([gen("Found"), gen("Missing")], { find });
    expect(unverified.map((c) => c.title)).toEqual(["Missing"]);
    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatchObject({
      deezer_id: "7", duration_seconds: 200, artwork_url: "b.jpg",
      deezer_url: "https://d/7", preview_url: "https://p.mp3", proposed_start: 43, proposed_end: 58,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/catalog/verifyCandidates.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/verifyCandidates.ts
import type { GeneratedCandidate, VerifiedCandidate } from "@/src/shared/types";
import { LIMITS } from "@/src/shared/config";
import { findDeezerMatch } from "@/src/engine/catalog/deezer";
import { logger } from "@/src/shared/logger";

/** Keep a proposed window inside the real track and at least sectionMin long. */
export function clampSection(start: number, end: number, duration: number): { start: number; end: number } {
  if (duration <= 0) return { start, end };
  let s = Math.max(0, start);
  let e = Math.min(end, duration);
  if (s >= duration - LIMITS.sectionMin) {
    s = Math.max(0, duration - LIMITS.sectionDefault - 5);
    e = Math.min(duration, s + LIMITS.sectionDefault);
  }
  if (e - s < LIMITS.sectionMin) e = Math.min(duration, s + LIMITS.sectionDefault);
  return { start: s, end: e };
}

export async function verifyCandidates(
  cands: GeneratedCandidate[],
  deps: { find?: typeof findDeezerMatch } = {},
): Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }> {
  const find = deps.find ?? findDeezerMatch;
  const verified: VerifiedCandidate[] = [];
  const unverified: GeneratedCandidate[] = [];
  // Parallel is fine: findDeezerMatch awaits the shared throttle before each request.
  const results = await Promise.all(cands.map(async (c) => ({ c, hit: await find(c) })));
  for (const { c, hit } of results) {
    if (!hit) {
      unverified.push(c);
      continue;
    }
    const { start, end } = clampSection(c.proposed_start, c.proposed_end, hit.duration);
    verified.push({
      ...c,
      proposed_start: start,
      proposed_end: end,
      deezer_id: String(hit.id),
      duration_seconds: hit.duration,
      artwork_url: hit.album?.cover_big ?? hit.album?.cover_medium ?? null,
      deezer_url: hit.link,
      preview_url: hit.preview ?? null,
    });
  }
  logger.info("verifyCandidates", { total: cands.length, verified: verified.length });
  return { verified, unverified };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/catalog/verifyCandidates.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/verifyCandidates.ts tests/engine/catalog/verifyCandidates.test.ts
git commit -m "Verify candidates against Deezer and clamp sections"
```

---

### Task 3.6: Scoring (model dimensions, rules, weights)

**Files:**
- Create: `src/engine/scoring/dimensions.ts`, `src/engine/scoring/modelScores.ts`, `src/engine/scoring/dialogue.ts`, `src/engine/scoring/config/overused.ts`, `src/engine/scoring/overuse.ts`, `src/engine/scoring/weights.ts`, `src/engine/scoring/scoreCandidates.ts`
- Test: `tests/engine/scoring/rules.test.ts`, `tests/engine/scoring/scoreCandidates.test.ts`

**Interfaces:**
- Consumes: `VerifiedCandidate`, `ScoredCandidate`, `ComponentScore`, `ComponentScores`, `Dimension`, `DIMENSIONS`; `callClaude`; `extractJson`; `normalizeKey`.
- Produces:
  ```ts
  // dimensions.ts
  export { DIMENSIONS } from "@/src/shared/types";
  export const MODEL_DIMENSIONS = ["semantic","emotional","aesthetic","pacing","cultural","originality"] as const;
  export type ModelDimension = (typeof MODEL_DIMENSIONS)[number];
  // modelScores.ts
  export const PROMPT_VERSION = "scoring-v1";
  export async function modelScores(analysis, brief, cands: VerifiedCandidate[], deps?: { call?: ClaudeCall }): Promise<Record<ModelDimension, ComponentScore>[]>; // aligned with cands
  // dialogue.ts
  export function dialogueScore(analysis: VideoAnalysis, cand: VerifiedCandidate): ComponentScore;
  // overuse.ts
  export function overuseScore(cand: { title: string; artist: string }): ComponentScore;
  // weights.ts
  export const WEIGHTS: Record<Dimension, number>;
  export function combine(scores: ComponentScores): number;
  // scoreCandidates.ts
  export async function scoreCandidates(analysis, brief, cands: VerifiedCandidate[], deps?: { scores?: typeof modelScores }): Promise<ScoredCandidate[]>; // sorted desc by total_score
  ```

- [ ] **Step 1: Write the failing rule tests**

```ts
// tests/engine/scoring/rules.test.ts
import { describe, it, expect } from "vitest";
import { combine, WEIGHTS } from "@/src/engine/scoring/weights";
import { dialogueScore } from "@/src/engine/scoring/dialogue";
import { overuseScore } from "@/src/engine/scoring/overuse";
import type { ComponentScores, VerifiedCandidate, VideoAnalysis } from "@/src/shared/types";
import { analysis } from "../candidates/generateCandidates.test";

const vc = (over: Partial<VerifiedCandidate>): VerifiedCandidate => ({
  title: "Song", artist: "Artist", proposed_start: 10, proposed_end: 25, section_reason: "instrumental build",
  fit_reason: "f", direction: "safe", deezer_id: "1", duration_seconds: 200, artwork_url: null,
  deezer_url: "https://d/1", preview_url: null, ...over,
});

describe("combine", () => {
  it("is a weighted mean", () => {
    const scores = Object.fromEntries(
      Object.keys(WEIGHTS).map((d) => [d, { score: 0.5, reason: "" }]),
    ) as ComponentScores;
    expect(combine(scores)).toBeCloseTo(0.5, 6);
    scores.semantic = { score: 1, reason: "" };
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(combine(scores)).toBeCloseTo((0.5 * (total - WEIGHTS.semantic) + WEIGHTS.semantic) / total, 6);
  });
});

describe("dialogueScore", () => {
  const talky: VideoAnalysis = { ...analysis, dialogue_present: true };
  it("is 1 when there is no dialogue", () => {
    expect(dialogueScore(analysis, vc({})).score).toBe(1);
  });
  it("penalises vocal sections when there is dialogue", () => {
    expect(dialogueScore(talky, vc({ section_reason: "the chorus vocals come in" })).score).toBe(0.3);
  });
  it("mildly penalises other sections when there is dialogue", () => {
    expect(dialogueScore(talky, vc({ section_reason: "instrumental build" })).score).toBe(0.8);
  });
});

describe("overuseScore", () => {
  it("flags a known overused song regardless of formatting", () => {
    expect(overuseScore({ title: "Oh No (Remastered)", artist: "Capone" }).score).toBe(0.4);
  });
  it("passes everything else", () => {
    expect(overuseScore({ title: "Obscure Tune", artist: "Nobody" }).score).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/scoring/rules.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write dimensions, weights and rules**

```ts
// src/engine/scoring/dimensions.ts
export { DIMENSIONS } from "@/src/shared/types";
export const MODEL_DIMENSIONS = ["semantic", "emotional", "aesthetic", "pacing", "cultural", "originality"] as const;
export type ModelDimension = (typeof MODEL_DIMENSIONS)[number];
```

```ts
// src/engine/scoring/weights.ts
// The ONLY place weights live. Ask before changing (CLAUDE.md).
import type { ComponentScores, Dimension } from "@/src/shared/types";
import { DIMENSIONS } from "@/src/shared/types";

export const WEIGHTS: Record<Dimension, number> = {
  semantic: 1.5,
  pacing: 1.25,
  emotional: 1,
  aesthetic: 1,
  cultural: 1,
  originality: 0.75,
  dialogue: 1,
};

export function combine(scores: ComponentScores): number {
  let num = 0;
  let den = 0;
  for (const d of DIMENSIONS) {
    num += WEIGHTS[d] * scores[d].score;
    den += WEIGHTS[d];
  }
  return den === 0 ? 0 : num / den;
}
```

```ts
// src/engine/scoring/dialogue.ts
import type { ComponentScore, VerifiedCandidate, VideoAnalysis } from "@/src/shared/types";

const VOCAL_RE = /vocal|chorus|sing|lyric|verse|hook|rap/i;

export function dialogueScore(analysis: VideoAnalysis, cand: VerifiedCandidate): ComponentScore {
  if (!analysis.dialogue_present) return { score: 1, reason: "no dialogue to compete with" };
  if (VOCAL_RE.test(cand.section_reason)) {
    return { score: 0.3, reason: "vocals will fight the dialogue" };
  }
  return { score: 0.8, reason: "section is mostly instrumental under speech" };
}
```

```ts
// src/engine/scoring/config/overused.ts
// Hand-maintained list of songs saturated on IG/TikTok. Replaced by song_trend_signals later.
// Edit freely; matching is loose (see normalize.ts).
export const OVERUSED: { title: string; artist: string }[] = [
  { title: "Oh No", artist: "Capone" },
  { title: "Monkeys Spinning Monkeys", artist: "Kevin MacLeod" },
  { title: "Aesthetic", artist: "Tollan Kim" },
  { title: "Sunroof", artist: "Nicky Youre" },
  { title: "Blinding Lights", artist: "The Weeknd" },
  { title: "Say So", artist: "Doja Cat" },
  { title: "Savage Love", artist: "Jawsh 685" },
  { title: "Stay", artist: "The Kid LAROI" },
  { title: "Flowers", artist: "Miley Cyrus" },
  { title: "Espresso", artist: "Sabrina Carpenter" },
];
```

```ts
// src/engine/scoring/overuse.ts
import type { ComponentScore } from "@/src/shared/types";
import { normalizeKey } from "@/src/engine/catalog/normalize";
import { OVERUSED } from "@/src/engine/scoring/config/overused";

const KEYS = new Set(OVERUSED.map((s) => normalizeKey(s.title, s.artist)));

export function overuseScore(cand: { title: string; artist: string }): ComponentScore {
  if (KEYS.has(normalizeKey(cand.title, cand.artist))) {
    return { score: 0.4, reason: "overused on social right now" };
  }
  return { score: 1, reason: "not on the overused list" };
}
```

- [ ] **Step 4: Run rule tests to verify they pass**

Run: `pnpm test -- tests/engine/scoring/rules.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing scoreCandidates test**

```ts
// tests/engine/scoring/scoreCandidates.test.ts
import { describe, it, expect, vi } from "vitest";
import { scoreCandidates } from "@/src/engine/scoring/scoreCandidates";
import { modelScores, PROMPT_VERSION } from "@/src/engine/scoring/modelScores";
import { DIMENSIONS, type VerifiedCandidate } from "@/src/shared/types";
import { analysis, brief } from "../candidates/generateCandidates.test";

const vc = (title: string, id: string): VerifiedCandidate => ({
  title, artist: "Artist", proposed_start: 10, proposed_end: 25, section_reason: "build",
  fit_reason: "f", direction: "safe", deezer_id: id, duration_seconds: 200, artwork_url: null,
  deezer_url: `https://d/${id}`, preview_url: null,
});

describe("scoreCandidates", () => {
  it("attaches all 7 dimensions and sorts by total descending", async () => {
    const scores = vi.fn(async (_a, _b, cands: VerifiedCandidate[]) =>
      cands.map((c) => {
        const s = c.title === "Great" ? 0.9 : 0.4;
        const one = { score: s, reason: "r" };
        return { semantic: one, emotional: one, aesthetic: one, pacing: one, cultural: one, originality: one };
      }),
    );
    const out = await scoreCandidates(analysis, brief, [vc("Meh", "1"), vc("Great", "2")], { scores });
    expect(out.map((c) => c.title)).toEqual(["Great", "Meh"]);
    for (const c of out) {
      expect(Object.keys(c.component_scores).sort()).toEqual([...DIMENSIONS].sort());
      expect(c.total_score).toBeGreaterThan(0);
    }
  });
});

describe("modelScores", () => {
  it("parses the batched response and fills missing items with 0.5", async () => {
    const call = vi.fn(async () => JSON.stringify([
      { index: 0, semantic: { score: 0.9, reason: "a" }, emotional: { score: 0.8, reason: "b" },
        aesthetic: { score: 0.7, reason: "c" }, pacing: { score: 0.6, reason: "d" },
        cultural: { score: 0.5, reason: "e" }, originality: { score: 0.4, reason: "f" } },
    ]));
    const out = await modelScores(analysis, brief, [vc("A", "1"), vc("B", "2")], { call });
    expect(out[0]!.semantic.score).toBe(0.9);
    expect(out[1]!.semantic).toEqual({ score: 0.5, reason: "unscored" });
    expect(PROMPT_VERSION).toBe("scoring-v1");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test -- tests/engine/scoring/scoreCandidates.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 7: Write modelScores and scoreCandidates**

```ts
// src/engine/scoring/modelScores.ts
import { z } from "zod";
import { ComponentScore, type MusicBrief, type VerifiedCandidate, type VideoAnalysis } from "@/src/shared/types";
import { MODELS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { PipelineError } from "@/src/shared/errors";
import { MODEL_DIMENSIONS, type ModelDimension } from "@/src/engine/scoring/dimensions";

export const PROMPT_VERSION = "scoring-v1";

const SYSTEM = `You are Songfit's music supervisor. You score candidate song sections against a specific
short-form video. Be decisive and discriminating: use the full 0–1 range, do not give everything 0.7.
A 1.0 means "this is exactly the song a great editor would pick"; a 0.2 means "clearly wrong".`;

const DIMENSION_DEFINITIONS: Record<ModelDimension, string> = {
  semantic: "Does the song make sense for what is literally happening in the video (subject, setting, story)?",
  emotional: "Does the emotional character of this section match or productively contrast the video's feel and the creator's intent?",
  aesthetic: "Does the sound match the visual world (luxury vs raw, modern vs retro, polished vs lo-fi)?",
  pacing: "Do the energy and rhythm of this section fit the edit's pace and cuts, and does its musical moment land near the key moment?",
  cultural: "Would this creator realistically use this song on Instagram or TikTok right now, given their niche and audience?",
  originality: "Is it good without being painfully obvious or exhausted?",
};

const Item = z.object({ index: z.number().int() }).and(
  z.object(Object.fromEntries(MODEL_DIMENSIONS.map((d) => [d, ComponentScore])) as Record<ModelDimension, typeof ComponentScore>),
);

export function buildScoringPrompt(analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[]): string {
  const defs = MODEL_DIMENSIONS.map((d) => `- ${d}: ${DIMENSION_DEFINITIONS[d]}`).join("\n");
  const list = cands
    .map((c, i) =>
      `${i}. "${c.title}" — ${c.artist} | section ${c.proposed_start}s–${c.proposed_end}s | ${c.section_reason} | proposed because: ${c.fit_reason}`)
    .join("\n");
  const moments = analysis.important_moments.map((m) => `${m.time}s ${m.type}`).join("; ") || "none";
  return `VIDEO
${analysis.summary}
Category: ${analysis.content_category}. Aesthetic: ${analysis.aesthetic.join(", ")}. Mood: ${analysis.mood.join(", ")}.
Energy ${analysis.energy}, pacing ${analysis.pacing}. Dialogue: ${analysis.dialogue_present ? "yes" : "no"}. Key moments: ${moments}.

MUSIC BRIEF
${brief.text}

DIMENSIONS (score each 0–1 with a one-line reason)
${defs}

CANDIDATES
${list}

Return ONLY a JSON array with one object per candidate:
{ "index": number, "semantic": {"score": number, "reason": string}, "emotional": {...}, "aesthetic": {...}, "pacing": {...}, "cultural": {...}, "originality": {...} }`;
}

export async function modelScores(
  analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[],
  deps: { call?: ClaudeCall } = {},
): Promise<Record<ModelDimension, ComponentScore>[]> {
  const call = deps.call ?? callClaude;
  const text = await call({
    model: MODELS.scoring, system: SYSTEM, user: buildScoringPrompt(analysis, brief, cands), maxTokens: 16000,
  });
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    throw new PipelineError("recommend", "scoring: no JSON in model output", text);
  }
  const arr = z.array(z.unknown()).safeParse(raw);
  if (!arr.success) throw new PipelineError("recommend", "scoring: output is not an array", text);

  const byIndex = new Map<number, Record<ModelDimension, ComponentScore>>();
  for (const item of arr.data) {
    const parsed = Item.safeParse(item);
    if (parsed.success) {
      const { index, ...rest } = parsed.data;
      byIndex.set(index, rest as Record<ModelDimension, ComponentScore>);
    }
  }
  const unscored = (): Record<ModelDimension, ComponentScore> =>
    Object.fromEntries(MODEL_DIMENSIONS.map((d) => [d, { score: 0.5, reason: "unscored" }])) as Record<ModelDimension, ComponentScore>;
  return cands.map((_, i) => byIndex.get(i) ?? unscored());
}
```

```ts
// src/engine/scoring/scoreCandidates.ts
import type { ComponentScores, MusicBrief, ScoredCandidate, VerifiedCandidate, VideoAnalysis } from "@/src/shared/types";
import { modelScores } from "@/src/engine/scoring/modelScores";
import { dialogueScore } from "@/src/engine/scoring/dialogue";
import { overuseScore } from "@/src/engine/scoring/overuse";
import { combine } from "@/src/engine/scoring/weights";

export async function scoreCandidates(
  analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[],
  deps: { scores?: typeof modelScores } = {},
): Promise<ScoredCandidate[]> {
  if (cands.length === 0) return [];
  const scores = deps.scores ?? modelScores;
  const fromModel = await scores(analysis, brief, cands);
  const scored: ScoredCandidate[] = cands.map((c, i) => {
    const component_scores: ComponentScores = {
      ...fromModel[i]!,
      dialogue: dialogueScore(analysis, c),
      originality: minScore(fromModel[i]!.originality, overuseScore(c)),
    };
    return { ...c, component_scores, total_score: combine(component_scores) };
  });
  return scored.sort((a, b) => b.total_score - a.total_score);
}

/** The overuse rule caps originality: a saturated song cannot score high on originality. */
function minScore(a: { score: number; reason: string }, b: { score: number; reason: string }) {
  return a.score <= b.score ? a : b;
}
```

- [ ] **Step 8: Run all scoring tests**

Run: `pnpm test -- tests/engine/scoring`
Expected: PASS, 8 tests.

- [ ] **Step 9: Commit**

```bash
pnpm typecheck && git add src/engine/scoring tests/engine/scoring
git commit -m "Add candidate scoring: batched model dimensions, dialogue and overuse rules, weights"
```

---

### Task 3.7: Diversify into 3 directions

**Files:**
- Create: `src/engine/diversify/diversify.ts`
- Test: `tests/engine/diversify/diversify.test.ts`

**Interfaces:**
- Consumes: `ScoredCandidate`, `Pick`, `DirectionTag`, `DIRECTION_LABEL`; `normalizeArtist`; `PipelineError`.
- Produces: `export function diversify(scored: ScoredCandidate[]): Pick[]` (length 3, ranks 1–3).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/diversify/diversify.test.ts
import { describe, it, expect } from "vitest";
import { diversify } from "@/src/engine/diversify/diversify";
import type { ScoredCandidate, DirectionTag } from "@/src/shared/types";

let n = 0;
const sc = (title: string, direction: DirectionTag, total: number, artist = `Artist ${++n}`): ScoredCandidate => ({
  title, artist, proposed_start: 30, proposed_end: 45, section_reason: "chorus", fit_reason: "f", direction,
  deezer_id: String(n), duration_seconds: 200, artwork_url: null, deezer_url: "", preview_url: null,
  component_scores: {} as ScoredCandidate["component_scores"], total_score: total,
});

describe("diversify", () => {
  it("picks top overall, then the best of a different direction, then the remaining direction", () => {
    const out = diversify([
      sc("S1", "safe", 0.9), sc("S2", "safe", 0.85), sc("C1", "current", 0.8), sc("U1", "unexpected", 0.6), sc("C2", "current", 0.7),
    ]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "U1"]);
    expect(out.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(out.map((p) => p.direction_label)).toEqual(["Best fit", "More current", "Unexpected"]);
    expect(out[0]).toMatchObject({ start_seconds: 30, end_seconds: 45 });
  });
  it("falls back to next best overall when a direction is empty", () => {
    const out = diversify([sc("S1", "safe", 0.9), sc("S2", "safe", 0.85), sc("C1", "current", 0.8)]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "S2"]);
  });
  it("avoids repeating an artist when a close alternative exists", () => {
    const out = diversify([
      sc("S1", "safe", 0.9, "Drake"), sc("C1", "current", 0.8, "Drake"), sc("C2", "current", 0.75, "SZA"), sc("U1", "unexpected", 0.5, "Khruangbin"),
    ]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C2", "U1"]);
  });
  it("keeps the repeated artist when the alternative is far worse", () => {
    const out = diversify([
      sc("S1", "safe", 0.9, "Drake"), sc("C1", "current", 0.8, "Drake"), sc("C2", "current", 0.5, "SZA"), sc("U1", "unexpected", 0.5, "Khruangbin"),
    ]);
    expect(out[1]!.title).toBe("C1");
  });
  it("throws with fewer than 3 candidates", () => {
    expect(() => diversify([sc("S1", "safe", 0.9), sc("S2", "safe", 0.8)])).toThrow(/fewer than 3/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/diversify/diversify.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/diversify/diversify.ts
import { DirectionTag, DIRECTION_LABEL, type Pick, type ScoredCandidate } from "@/src/shared/types";
import { PipelineError } from "@/src/shared/errors";
import { normalizeArtist } from "@/src/engine/catalog/normalize";

const ARTIST_TOLERANCE = 0.1;

export function diversify(scored: ScoredCandidate[]): Pick[] {
  if (scored.length < 3) {
    throw new PipelineError("recommend", `fewer than 3 verified candidates (${scored.length})`);
  }
  const sorted = [...scored].sort((a, b) => b.total_score - a.total_score);
  const picks: ScoredCandidate[] = [];
  const usedIds = new Set<string>();
  const usedArtists = new Set<string>();

  const take = (c: ScoredCandidate) => {
    picks.push(c);
    usedIds.add(c.deezer_id);
    usedArtists.add(normalizeArtist(c.artist));
  };
  const preferNewArtist = (pool: ScoredCandidate[]): ScoredCandidate | undefined => {
    const first = pool[0];
    if (!first || !usedArtists.has(normalizeArtist(first.artist))) return first;
    const alt = pool.find(
      (c) => !usedArtists.has(normalizeArtist(c.artist)) && first.total_score - c.total_score <= ARTIST_TOLERANCE,
    );
    return alt ?? first;
  };

  take(sorted[0]!);
  while (picks.length < 3) {
    const available = sorted.filter((c) => !usedIds.has(c.deezer_id));
    const takenDirs = new Set(picks.map((p) => p.direction));
    const fresh = available.filter((c) => !takenDirs.has(c.direction));
    const choice = preferNewArtist(fresh.length ? fresh : available);
    if (!choice) break;
    take(choice);
  }
  if (picks.length < 3) throw new PipelineError("recommend", "could not assemble 3 distinct picks");

  return picks.map((c, i) => ({
    ...c,
    rank: (i + 1) as 1 | 2 | 3,
    direction_label: DIRECTION_LABEL[c.direction],
    start_seconds: c.proposed_start,
    end_seconds: c.proposed_end,
  }));
}

// DirectionTag is imported so the module's contract with the enum is explicit; keep for readers.
void DirectionTag;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/diversify/diversify.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/diversify tests/engine/diversify
git commit -m "Add diversification into three directions"
```

---

### Task 3.8: Section selection and reveal alignment

**Files:**
- Create: `src/engine/sections/selectSections.ts`
- Test: `tests/engine/sections/selectSections.test.ts`

**Interfaces:**
- Consumes: `Pick`, `VideoAnalysis`, `LIMITS.sectionMin/sectionMax`.
- Produces:
  ```ts
  export function fitLength(start: number, end: number, duration: number): { start: number; end: number };
  export function alignToMoment(pick: Pick, analysis: VideoAnalysis): { start: number; end: number } | null;
  export function selectSections(picks: Pick[], analysis: VideoAnalysis): Pick[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/sections/selectSections.test.ts
import { describe, it, expect } from "vitest";
import { fitLength, alignToMoment, selectSections } from "@/src/engine/sections/selectSections";
import type { Pick, VideoAnalysis } from "@/src/shared/types";
import { analysis } from "../candidates/generateCandidates.test";

const pick = (over: Partial<Pick>): Pick => ({
  title: "T", artist: "A", proposed_start: 43, proposed_end: 58, section_reason: "chorus hits", fit_reason: "f",
  direction: "safe", deezer_id: "1", duration_seconds: 200, artwork_url: null, deezer_url: "", preview_url: null,
  component_scores: {} as Pick["component_scores"], total_score: 0.8, rank: 1, direction_label: "Best fit",
  start_seconds: 43, end_seconds: 58, ...over,
});

describe("fitLength", () => {
  it("shrinks a long window around its midpoint", () => {
    expect(fitLength(40, 70, 200)).toEqual({ start: 45, end: 65 });
  });
  it("expands a short window around its midpoint", () => {
    expect(fitLength(50, 54, 200)).toEqual({ start: 46, end: 58 });
  });
  it("clamps at the start of the track", () => {
    expect(fitLength(0, 5, 200)).toEqual({ start: 0, end: 12 });
  });
});

describe("alignToMoment", () => {
  it("shifts the window so the hit lands on the reveal", () => {
    // reveal at 7.8 s, hit at 43 s → start at 35.2 s so the hit plays at video time 7.8
    const out = alignToMoment(pick({}), analysis);
    expect(out).toEqual({ start: 35.2, end: 50.2 });
  });
  it("returns null when the section reason is not a hit, or no key moment exists", () => {
    expect(alignToMoment(pick({ section_reason: "mellow verse" }), analysis)).toBeNull();
    const quiet: VideoAnalysis = { ...analysis, important_moments: [] };
    expect(alignToMoment(pick({}), quiet)).toBeNull();
  });
  it("clamps at 0 when the hit is earlier than the reveal", () => {
    expect(alignToMoment(pick({ proposed_start: 5, proposed_end: 20, start_seconds: 5, end_seconds: 20 }), analysis))
      .toEqual({ start: 0, end: 15 });
  });
});

describe("selectSections", () => {
  it("applies alignment, length rules, and nudges #2 when all lengths match", () => {
    const quiet: VideoAnalysis = { ...analysis, important_moments: [] };
    const out = selectSections(
      [pick({ rank: 1 }), pick({ rank: 2, deezer_id: "2" }), pick({ rank: 3, deezer_id: "3" })],
      quiet,
    );
    expect(out.map((p) => p.end_seconds - p.start_seconds)).toEqual([15, 17, 15]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/sections/selectSections.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/sections/selectSections.ts
//
// ASSUMPTION (replace when we have real audio-structure analysis):
// The generator's proposed_start is the second where the song's musical "hit" begins
// (chorus entry, drop). A creator starts the chosen section at video time 0. So to make the
// hit land on a video moment at time T, the section must start at (proposed_start - T),
// clamped to 0, keeping the same length. Alignment only applies when T is inside the section.
import type { Pick, VideoAnalysis } from "@/src/shared/types";
import { LIMITS } from "@/src/shared/config";

const KEY_MOMENT_RE = /reveal|climax|drop|transition/i;
const HIT_RE = /chorus|drop|hit|build/i;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function fitLength(start: number, end: number, duration: number): { start: number; end: number } {
  const len = end - start;
  let s = start;
  let e = end;
  if (len > LIMITS.sectionMax || len < LIMITS.sectionMin) {
    const target = len > LIMITS.sectionMax ? LIMITS.sectionMax : LIMITS.sectionMin;
    const mid = (start + end) / 2;
    s = mid - target / 2;
    e = mid + target / 2;
  }
  if (s < 0) {
    e -= s;
    s = 0;
  }
  if (duration > 0 && e > duration) {
    s = Math.max(0, s - (e - duration));
    e = duration;
  }
  return { start: round1(s), end: round1(e) };
}

export function alignToMoment(pick: Pick, analysis: VideoAnalysis): { start: number; end: number } | null {
  if (!HIT_RE.test(pick.section_reason)) return null;
  const moment = [...analysis.important_moments]
    .filter((m) => KEY_MOMENT_RE.test(m.type))
    .sort((a, b) => a.time - b.time)[0];
  if (!moment) return null;
  const len = pick.end_seconds - pick.start_seconds;
  if (moment.time >= len) return null; // the hit could not fall inside a section this short
  const start = Math.max(0, pick.proposed_start - moment.time);
  return { start: round1(start), end: round1(start + len) };
}

export function selectSections(picks: Pick[], analysis: VideoAnalysis): Pick[] {
  const out = picks.map((p) => {
    const aligned = alignToMoment(p, analysis) ?? { start: p.start_seconds, end: p.end_seconds };
    const fitted = fitLength(aligned.start, aligned.end, p.duration_seconds);
    return { ...p, start_seconds: fitted.start, end_seconds: fitted.end };
  });
  const lengths = out.map((p) => round1(p.end_seconds - p.start_seconds));
  if (out.length === 3 && lengths.every((l) => l === lengths[0])) {
    const p2 = out[1]!;
    const nudgedEnd = Math.min(p2.duration_seconds, p2.end_seconds + 2);
    if (nudgedEnd - p2.start_seconds <= LIMITS.sectionMax) out[1] = { ...p2, end_seconds: round1(nudgedEnd) };
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/sections/selectSections.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/sections tests/engine/sections
git commit -m "Add section selection with reveal alignment and length rules"
```

---

### Task 3.9: Explanations in the Songfit voice

**Files:**
- Create: `src/engine/explain/explainPicks.ts`
- Test: `tests/engine/explain/explainPicks.test.ts`

**Interfaces:**
- Consumes: `Pick`, `FinalRecommendation`, `VideoAnalysis`, `MusicBrief`; `callClaude`; `extractJson`; `findItunesPreview` (Task 3.4); `DIMENSIONS`.
- Produces:
  ```ts
  export const PROMPT_VERSION = "explain-v1";
  export function spotifySearchUrl(title: string, artist: string): string;
  export async function explainPicks(picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief, deps?: { call?: ClaudeCall; itunes?: typeof findItunesPreview }): Promise<FinalRecommendation[]>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/explain/explainPicks.test.ts
import { describe, it, expect, vi } from "vitest";
import { explainPicks, spotifySearchUrl } from "@/src/engine/explain/explainPicks";
import type { Pick } from "@/src/shared/types";
import { analysis, brief } from "../candidates/generateCandidates.test";

const pick = (rank: 1 | 2 | 3, preview: string | null): Pick => ({
  title: `Song ${rank}`, artist: "Artist", proposed_start: 43, proposed_end: 58, section_reason: "chorus", fit_reason: "fits",
  direction: "safe", deezer_id: String(rank), duration_seconds: 200, artwork_url: null, deezer_url: "", preview_url: preview,
  component_scores: {
    semantic: { score: 0.9, reason: "night city" }, emotional: { score: 0.8, reason: "confident" },
    aesthetic: { score: 0.5, reason: "" }, pacing: { score: 0.5, reason: "" }, dialogue: { score: 1, reason: "" },
    cultural: { score: 0.5, reason: "" }, originality: { score: 0.5, reason: "" },
  },
  total_score: 0.8, rank, direction_label: "Best fit", start_seconds: 43, end_seconds: 58,
});

describe("explainPicks", () => {
  it("attaches explanations, spotify url and iTunes preview fallback", async () => {
    const call = vi.fn(async () => JSON.stringify([
      { rank: 1, explanation: "One." }, { rank: 2, explanation: "Two." }, { rank: 3, explanation: "Three." },
    ]));
    const itunes = vi.fn(async (title: string) =>
      title === "Song 2" ? { itunesId: "99", previewUrl: "https://i.m4a" } : null);
    const out = await explainPicks([pick(1, "https://d.mp3"), pick(2, null), pick(3, null)], analysis, brief, { call, itunes });
    expect(out.map((r) => r.explanation)).toEqual(["One.", "Two.", "Three."]);
    expect(out[0]!.preview_url).toBe("https://d.mp3");
    expect(out[1]!.preview_url).toBe("https://i.m4a");
    expect(out[1]!.itunes_id).toBe("99");
    expect(out[2]!.preview_url).toBeNull();
    expect(out[0]!.spotify_url).toBe(spotifySearchUrl("Song 1", "Artist"));
  });
  it("falls back to the fit reason when the model misses a rank", async () => {
    const call = vi.fn(async () => JSON.stringify([{ rank: 1, explanation: "One." }]));
    const itunes = vi.fn(async () => null);
    const out = await explainPicks([pick(1, null), pick(2, null), pick(3, null)], analysis, brief, { call, itunes });
    expect(out[1]!.explanation).toBe("fits");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/engine/explain/explainPicks.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/explain/explainPicks.ts
import { z } from "zod";
import { DIMENSIONS, type FinalRecommendation, type MusicBrief, type Pick, type VideoAnalysis } from "@/src/shared/types";
import { MODELS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { findItunesPreview } from "@/src/engine/catalog/itunes";

export const PROMPT_VERSION = "explain-v1";

const SYSTEM = `You write the one-line reasons under Songfit's song picks. Voice: a sharp friend who edits
video. Second person. Two sentences, each under 20 words. No hype, no emojis, no exclamation marks,
no words like "perfect", "vibe", "elevate". Never mention scores, models, AI, or how the pick was made.
Each reason must name something specific from the video and say what the song section does for it.`;

const Item = z.object({ rank: z.number().int(), explanation: z.string().min(1) });

function topReasons(p: Pick): string {
  return DIMENSIONS
    .map((d) => p.component_scores[d])
    .filter((s) => s && s.reason)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.reason)
    .join("; ");
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function buildExplainPrompt(picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief): string {
  const list = picks
    .map((p) => `#${p.rank} (${p.direction_label}): "${p.title}" — ${p.artist}, use ${fmt(p.start_seconds)}–${fmt(p.end_seconds)}.
   Section: ${p.section_reason}. Why proposed: ${p.fit_reason}. Strongest reasons: ${topReasons(p) || "n/a"}.`)
    .join("\n");
  return `VIDEO: ${analysis.summary}
Key moments: ${analysis.important_moments.map((m) => `${m.time}s ${m.type}`).join("; ") || "none"}
BRIEF: ${brief.text}

PICKS
${list}

Return ONLY a JSON array: [{ "rank": 1, "explanation": "..." }, { "rank": 2, ... }, { "rank": 3, ... }]`;
}

export function spotifySearchUrl(title: string, artist: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`)}`;
}

export async function explainPicks(
  picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief,
  deps: { call?: ClaudeCall; itunes?: typeof findItunesPreview } = {},
): Promise<FinalRecommendation[]> {
  const call = deps.call ?? callClaude;
  const itunes = deps.itunes ?? findItunesPreview;

  const [text, previews] = await Promise.all([
    call({ model: MODELS.explain, system: SYSTEM, user: buildExplainPrompt(picks, analysis, brief), maxTokens: 1500 }),
    Promise.all(picks.map((p) => itunes(p.title, p.artist))),
  ]);

  const byRank = new Map<number, string>();
  try {
    const arr = z.array(z.unknown()).safeParse(extractJson(text));
    if (arr.success) {
      for (const item of arr.data) {
        const parsed = Item.safeParse(item);
        if (parsed.success) byRank.set(parsed.data.rank, parsed.data.explanation.trim());
      }
    }
  } catch {
    // fall through: every pick falls back to its fit_reason
  }

  return picks.map((p, i) => {
    const it = previews[i] ?? null;
    return {
      ...p,
      explanation: byRank.get(p.rank) ?? p.fit_reason,
      spotify_url: spotifySearchUrl(p.title, p.artist),
      itunes_id: it?.itunesId ?? null,
      preview_url: p.preview_url ?? it?.previewUrl ?? null,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/engine/explain/explainPicks.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/explain tests/engine/explain
git commit -m "Add Songfit-voice explanations with Spotify link and iTunes preview fallback"
```

---

### Task 3.10: Orchestrator `recommendSubmission` and pipeline wiring

**Files:**
- Modify: `src/db/queries/candidates.ts` (`replaceCandidates` returns inserted ids), `src/db/queries/recommendations.ts`
- Create: `src/engine/recommend.ts`
- Modify: `src/pipeline/run.ts`
- Test: `tests/engine/recommend.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3.2–3.9; from Phase 0/2: `getSubmission(id)`, `getAnalysis(submissionId): Promise<{ analysis: VideoAnalysis; brief: MusicBrief; row } | null>` (Phase 0, Task 0.4), `setSubmissionStatus(id, status, error?)`, `logEvent`, `PipelineError`, `analyzeSubmission`.
- Produces:
  ```ts
  // src/db/queries/candidates.ts
  export type CandidateRow = { submission_id: string; title: string; artist: string; deezer_id: string | null; itunes_id: string | null; duration_seconds: number | null; verified: boolean; proposed_start: number; proposed_end: number; generator_reason: string; direction: string; component_scores: ComponentScores | null; total_score: number | null; prompt_version: string };
  export async function replaceCandidates(submissionId: string, rows: CandidateRow[]): Promise<{ id: string; deezer_id: string | null }[]>;
  // src/db/queries/recommendations.ts
  export type RecommendationRow = { submission_id: string; candidate_id: string | null; rank: number; direction_label: string; title: string; artist: string; start_seconds: number; end_seconds: number; explanation: string; spotify_url: string; deezer_url: string | null; artwork_url: string | null; preview_url: string | null };
  export async function replaceRecommendations(submissionId: string, rows: RecommendationRow[]): Promise<void>;
  // src/engine/recommend.ts
  export async function recommendSubmission(submissionId: string, deps?: RecommendDeps): Promise<void>;
  ```

- [ ] **Step 1: Confirm the `direction` column exists**

Phase 0's `0001_init.sql` already adds `direction`, `artwork_url`, `deezer_url` and `preview_url` to `candidates` and documents them in `docs/DATA_MODEL.md`. No migration in this task.

Run: `grep -n "direction" supabase/migrations/0001_init.sql src/db/types.ts | head`
Expected: both files mention `direction` under candidates. If not, stop and fix Phase 0 Task 0.3 first.

- [ ] **Step 2: Make `replaceCandidates` return ids and define the row types**

```ts
// src/db/queries/candidates.ts
import { createServiceClient } from "@/src/db/client";
import type { ComponentScores } from "@/src/shared/types";

export type CandidateRow = {
  submission_id: string;
  title: string;
  artist: string;
  deezer_id: string | null;
  itunes_id: string | null;
  duration_seconds: number | null;
  verified: boolean;
  proposed_start: number;
  proposed_end: number;
  generator_reason: string;
  direction: string;
  component_scores: ComponentScores | null;
  total_score: number | null;
  prompt_version: string;
};

/** Idempotent: wipes this submission's candidates and inserts the new set. */
export async function replaceCandidates(
  submissionId: string, rows: CandidateRow[],
): Promise<{ id: string; deezer_id: string | null }[]> {
  const db = createServiceClient();
  const del = await db.from("candidates").delete().eq("submission_id", submissionId);
  if (del.error) throw del.error;
  if (rows.length === 0) return [];
  const ins = await db.from("candidates").insert(rows).select("id, deezer_id");
  if (ins.error) throw ins.error;
  return ins.data;
}

export async function listCandidates(submissionId: string) {
  const db = createServiceClient();
  const res = await db.from("candidates").select("*").eq("submission_id", submissionId)
    .order("total_score", { ascending: false, nullsFirst: false });
  if (res.error) throw res.error;
  return res.data;
}
```

```ts
// src/db/queries/recommendations.ts
import { createServiceClient } from "@/src/db/client";

export type RecommendationRow = {
  submission_id: string;
  candidate_id: string | null;
  rank: number;
  direction_label: string;
  title: string;
  artist: string;
  start_seconds: number;
  end_seconds: number;
  explanation: string;
  spotify_url: string;
  deezer_url: string | null;
  artwork_url: string | null;
  preview_url: string | null;
};

export async function replaceRecommendations(submissionId: string, rows: RecommendationRow[]): Promise<void> {
  const db = createServiceClient();
  const del = await db.from("recommendations").delete().eq("submission_id", submissionId);
  if (del.error) throw del.error;
  const ins = await db.from("recommendations").insert(rows);
  if (ins.error) throw ins.error;
}

export async function listRecommendations(submissionId: string) {
  const db = createServiceClient();
  const res = await db.from("recommendations").select("*").eq("submission_id", submissionId).order("rank");
  if (res.error) throw res.error;
  return res.data;
}
```

- [ ] **Step 3: Write the failing orchestrator test**

```ts
// tests/engine/recommend.test.ts
import { describe, it, expect, vi } from "vitest";
import { recommendSubmission, type RecommendDeps } from "@/src/engine/recommend";
import type { GeneratedCandidate, VerifiedCandidate, ScoredCandidate, Pick, FinalRecommendation } from "@/src/shared/types";
import { analysis, brief } from "./candidates/generateCandidates.test";

const gen = (title: string): GeneratedCandidate => ({
  title, artist: "A", proposed_start: 10, proposed_end: 25, section_reason: "chorus", fit_reason: "f", direction: "safe",
});
const ver = (c: GeneratedCandidate, id: string): VerifiedCandidate => ({
  ...c, deezer_id: id, duration_seconds: 200, artwork_url: null, deezer_url: `https://d/${id}`, preview_url: null,
});
const one = { score: 0.7, reason: "r" };
const scoredOf = (v: VerifiedCandidate): ScoredCandidate => ({
  ...v, total_score: 0.7,
  component_scores: { semantic: one, emotional: one, aesthetic: one, pacing: one, dialogue: one, cultural: one, originality: one },
});

describe("recommendSubmission", () => {
  it("runs the stages in order and persists unverified rows with verified=false", async () => {
    const calls: string[] = [];
    const generated = [gen("V1"), gen("V2"), gen("V3"), gen("Missing")];
    const verified = generated.slice(0, 3).map((c, i) => ver(c, String(i + 1)));
    const scored = verified.map(scoredOf);
    const picks: Pick[] = scored.map((s, i) => ({
      ...s, rank: (i + 1) as 1 | 2 | 3, direction_label: "Best fit", start_seconds: 10, end_seconds: 25,
    }));
    const finals: FinalRecommendation[] = picks.map((p) => ({ ...p, explanation: "e", spotify_url: "s", itunes_id: null }));
    const replaceCandidates = vi.fn(async (_id: string, rows: { deezer_id: string | null; verified: boolean }[]) => {
      calls.push("replaceCandidates");
      return rows.map((r, i) => ({ id: `cand-${i}`, deezer_id: r.deezer_id }));
    });
    const replaceRecommendations = vi.fn(async () => { calls.push("replaceRecommendations"); });
    const deps: RecommendDeps = {
      getAnalysis: vi.fn(async () => ({ analysis, brief })),
      generate: vi.fn(async () => { calls.push("generate"); return generated; }),
      verify: vi.fn(async () => { calls.push("verify"); return { verified, unverified: [generated[3]!] }; }),
      score: vi.fn(async () => { calls.push("score"); return scored; }),
      diversify: vi.fn(() => { calls.push("diversify"); return picks; }),
      sections: vi.fn(() => { calls.push("sections"); return picks; }),
      explain: vi.fn(async () => { calls.push("explain"); return finals; }),
      replaceCandidates,
      replaceRecommendations,
      setStatus: vi.fn(async () => { calls.push("setStatus"); }),
      logEvent: vi.fn(async () => {}),
    };
    await recommendSubmission("sub-1", deps);
    expect(calls).toEqual(["generate", "verify", "score", "replaceCandidates", "diversify", "sections", "explain", "replaceRecommendations", "setStatus"]);
    const rows = replaceCandidates.mock.calls[0]![1];
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => !r.verified)).toHaveLength(1);
    expect(deps.setStatus).toHaveBeenCalledWith("sub-1", "ready");
    const recRows = (replaceRecommendations.mock.calls[0] as unknown as [string, { candidate_id: string | null }[]])[1];
    expect(recRows.map((r) => r.candidate_id)).toEqual(["cand-0", "cand-1", "cand-2"]);
  });

  it("regenerates once when fewer than 3 verify, then fails if still short", async () => {
    const generate = vi.fn(async () => [gen("X")]);
    const deps: RecommendDeps = {
      getAnalysis: vi.fn(async () => ({ analysis, brief })),
      generate,
      verify: vi.fn(async () => ({ verified: [], unverified: [gen("X")] })),
      score: vi.fn(async () => []),
      diversify: vi.fn(() => []), sections: vi.fn(() => []), explain: vi.fn(async () => []),
      replaceCandidates: vi.fn(async () => []), replaceRecommendations: vi.fn(async () => {}),
      setStatus: vi.fn(async () => {}), logEvent: vi.fn(async () => {}),
    };
    await expect(recommendSubmission("sub-2", deps)).rejects.toThrow(/fewer than 3/);
    expect(generate).toHaveBeenCalledTimes(2);
    expect((generate.mock.calls[1] as unknown[])[2]).toMatchObject({ note: expect.stringContaining("Deezer") });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test -- tests/engine/recommend.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 5: Write the orchestrator**

```ts
// src/engine/recommend.ts
import type {
  FinalRecommendation, GeneratedCandidate, MusicBrief, Pick, ScoredCandidate, SubmissionStatus,
  VerifiedCandidate, VideoAnalysis,
} from "@/src/shared/types";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { generateCandidates, PROMPT_VERSION as CANDIDATES_VERSION } from "@/src/engine/candidates/generateCandidates";
import { verifyCandidates } from "@/src/engine/catalog/verifyCandidates";
import { scoreCandidates } from "@/src/engine/scoring/scoreCandidates";
import { PROMPT_VERSION as SCORING_VERSION } from "@/src/engine/scoring/modelScores";
import { diversify } from "@/src/engine/diversify/diversify";
import { selectSections } from "@/src/engine/sections/selectSections";
import { explainPicks } from "@/src/engine/explain/explainPicks";
import { getAnalysis } from "@/src/db/queries/analyses";
import { replaceCandidates, type CandidateRow } from "@/src/db/queries/candidates";
import { replaceRecommendations, type RecommendationRow } from "@/src/db/queries/recommendations";
import { setSubmissionStatus } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";

export type RecommendDeps = {
  getAnalysis: (submissionId: string) => Promise<{ analysis: VideoAnalysis; brief: MusicBrief } | null>;
  generate: (brief: MusicBrief, analysis: VideoAnalysis, opts?: { note?: string }) => Promise<GeneratedCandidate[]>;
  verify: (cands: GeneratedCandidate[]) => Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }>;
  score: (analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[]) => Promise<ScoredCandidate[]>;
  diversify: (scored: ScoredCandidate[]) => Pick[];
  sections: (picks: Pick[], analysis: VideoAnalysis) => Pick[];
  explain: (picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief) => Promise<FinalRecommendation[]>;
  replaceCandidates: (submissionId: string, rows: CandidateRow[]) => Promise<{ id: string; deezer_id: string | null }[]>;
  replaceRecommendations: (submissionId: string, rows: RecommendationRow[]) => Promise<void>;
  setStatus: (id: string, status: SubmissionStatus, error?: string) => Promise<void>;
  logEvent: typeof logEvent;
};

const defaultDeps: RecommendDeps = {
  getAnalysis,
  generate: generateCandidates,
  verify: verifyCandidates,
  score: scoreCandidates,
  diversify,
  sections: selectSections,
  explain: explainPicks,
  replaceCandidates,
  replaceRecommendations,
  setStatus: setSubmissionStatus,
  logEvent,
};

const RETRY_NOTE = "Previous suggestions could not be found on Deezer; propose different, well-known songs by the original artists.";

function toCandidateRow(submissionId: string, c: GeneratedCandidate | ScoredCandidate, verified: boolean): CandidateRow {
  const s = c as Partial<ScoredCandidate>;
  return {
    submission_id: submissionId,
    title: c.title,
    artist: c.artist,
    deezer_id: s.deezer_id ?? null,
    itunes_id: null,
    duration_seconds: s.duration_seconds ?? null,
    verified,
    proposed_start: c.proposed_start,
    proposed_end: c.proposed_end,
    generator_reason: `${c.section_reason} / ${c.fit_reason}`,
    direction: c.direction,
    component_scores: s.component_scores ?? null,
    total_score: s.total_score ?? null,
    prompt_version: verified ? `${CANDIDATES_VERSION}+${SCORING_VERSION}` : CANDIDATES_VERSION,
  };
}

function toRecommendationRow(submissionId: string, candidateId: string | null, r: FinalRecommendation): RecommendationRow {
  return {
    submission_id: submissionId,
    candidate_id: candidateId,
    rank: r.rank,
    direction_label: r.direction_label,
    title: r.title,
    artist: r.artist,
    start_seconds: r.start_seconds,
    end_seconds: r.end_seconds,
    explanation: r.explanation,
    spotify_url: r.spotify_url,
    deezer_url: r.deezer_url || null,
    artwork_url: r.artwork_url,
    preview_url: r.preview_url,
  };
}

export async function recommendSubmission(submissionId: string, deps: RecommendDeps = defaultDeps): Promise<void> {
  const started = Date.now();
  const stored = await deps.getAnalysis(submissionId);
  if (!stored) throw new PipelineError("recommend", "no analysis stored for submission");
  const { analysis, brief } = stored;

  let generated = await deps.generate(brief, analysis);
  let { verified, unverified } = await deps.verify(generated);
  if (verified.length < 3) {
    logger.warn("recommend: regenerating, too few verified", { submissionId, verified: verified.length });
    generated = await deps.generate(brief, analysis, { note: RETRY_NOTE });
    ({ verified, unverified } = await deps.verify(generated));
  }

  const scored = await deps.score(analysis, brief, verified);
  const rows: CandidateRow[] = [
    ...scored.map((c) => toCandidateRow(submissionId, c, true)),
    ...unverified.map((c) => toCandidateRow(submissionId, c, false)),
  ];
  const inserted = await deps.replaceCandidates(submissionId, rows);
  const idByDeezer = new Map(inserted.filter((r) => r.deezer_id).map((r) => [r.deezer_id as string, r.id]));

  const picks = deps.sections(deps.diversify(scored), analysis);
  const finals = await deps.explain(picks, analysis, brief);

  await deps.replaceRecommendations(
    submissionId,
    finals.map((r) => toRecommendationRow(submissionId, idByDeezer.get(r.deezer_id) ?? null, r)),
  );
  await deps.setStatus(submissionId, "ready");
  await deps.logEvent({
    name: "recommendations_ready", submissionId,
    metadata: { candidates: rows.length, verified: verified.length, ms: Date.now() - started },
  });
}
```

`setSubmissionStatus(id, "ready")` (Phase 0) must also set `recommended_at = now()` when status is `ready`; if the Phase 0 implementation does not, add that branch there now:

```ts
// in src/db/queries/submissions.ts, inside setSubmissionStatus
const patch: Record<string, unknown> = { status, error: error ?? null };
if (status === "recommending") patch.analyzed_at = new Date().toISOString();
if (status === "ready") patch.recommended_at = new Date().toISOString();
```

- [ ] **Step 6: Wire into the pipeline**

```ts
// src/pipeline/run.ts  (replace the body written in Phase 2 with this)
import { analyzeSubmission } from "@/src/analysis";
import { recommendSubmission } from "@/src/engine/recommend";
import { getSubmission, setSubmissionStatus } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";

/** Resumable: picks up from the submission's current status. Safe to call again after a failure. */
export async function runSubmission(submissionId: string): Promise<void> {
  const sub = await getSubmission(submissionId);
  if (!sub) throw new Error(`submission ${submissionId} not found`);

  let stage: "analyze" | "recommend" =
    sub.status === "uploaded" || sub.status === "analyzing" ? "analyze" : "recommend";
  if (sub.status === "failed") stage = sub.error?.startsWith("recommend:") ? "recommend" : "analyze";
  if (sub.status === "ready") return;

  try {
    if (stage === "analyze") {
      await setSubmissionStatus(submissionId, "analyzing");
      await analyzeSubmission(submissionId);
      await setSubmissionStatus(submissionId, "recommending");
    } else {
      await setSubmissionStatus(submissionId, "recommending");
    }
    await recommendSubmission(submissionId);
  } catch (err) {
    const e = err instanceof PipelineError ? err : new PipelineError(stage, err instanceof Error ? err.message : String(err));
    logger.error("pipeline failed", { submissionId, stage: e.stage, message: e.message });
    await setSubmissionStatus(submissionId, "failed", `${e.stage}: ${e.message}`);
    await logEvent({ name: "pipeline_failed", submissionId, metadata: { stage: e.stage, error: e.message } });
    throw e;
  }
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm test -- tests/engine`
Expected: PASS, all engine tests (recommend: 2).

- [ ] **Step 8: Commit**

```bash
pnpm typecheck && git add src/db src/engine/recommend.ts src/pipeline/run.ts tests/engine/recommend.test.ts
git commit -m "Add recommendation orchestrator and wire it into the pipeline"
```

---

### Task 3.11: Results page and recommendation cards

**Files:**
- Create: `src/shared/format.ts`, `components/RecommendationCard.tsx`, `components/ResultsView.tsx`
- Modify: `app/api/submissions/[id]/route.ts`, `app/results/[id]/page.tsx`
- Modify: `src/db/queries/submissions.ts` (add `markViewed`)
- Test: `tests/shared/format.test.ts`

**Interfaces:**
- Consumes: `listRecommendations` (Task 3.10), `getSubmission`, `getCreator` (Phase 1), `logEvent`, `<WaitingState submissionId>` (Phase 1).
- Produces:
  ```ts
  export function formatTime(seconds: number): string;             // "0:43"
  export type RecommendationView = { rank: number; direction_label: string; title: string; artist: string; start_seconds: number; end_seconds: number; explanation: string; artwork_url: string | null; preview_url: string | null; spotify_url: string };
  // GET /api/submissions/[id] → { status: SubmissionStatus; recommendations: RecommendationView[] }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/format.test.ts
import { describe, it, expect } from "vitest";
import { formatTime } from "@/src/shared/format";

describe("formatTime", () => {
  it("formats m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(43)).toBe("0:43");
    expect(formatTime(67.4)).toBe("1:07");
    expect(formatTime(600)).toBe("10:00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/shared/format.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `formatTime`**

```ts
// src/shared/format.ts
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/shared/format.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Return recommendations from the status route**

```ts
// app/api/submissions/[id]/route.ts
import { NextResponse } from "next/server";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { listRecommendations } from "@/src/db/queries/recommendations";

export type RecommendationView = {
  rank: number; direction_label: string; title: string; artist: string;
  start_seconds: number; end_seconds: number; explanation: string;
  artwork_url: string | null; preview_url: string | null; spotify_url: string;
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sub = await getSubmission(id);
  if (!sub || sub.creator_id !== creator.id) return NextResponse.json({ error: "not found" }, { status: 404 });

  const recommendations: RecommendationView[] =
    sub.status === "ready"
      ? (await listRecommendations(id)).map((r) => ({
          rank: r.rank, direction_label: r.direction_label, title: r.title, artist: r.artist,
          start_seconds: Number(r.start_seconds), end_seconds: Number(r.end_seconds),
          explanation: r.explanation, artwork_url: r.artwork_url, preview_url: r.preview_url, spotify_url: r.spotify_url,
        }))
      : [];
  return NextResponse.json({ status: sub.status, recommendations });
}
```

- [ ] **Step 6: Add `markViewed` and render the results page**

```ts
// add to src/db/queries/submissions.ts
/** Sets viewed_at once; returns true the first time. */
export async function markViewed(id: string): Promise<boolean> {
  const db = createServiceClient();
  const res = await db.from("submissions").update({ viewed_at: new Date().toISOString() })
    .eq("id", id).is("viewed_at", null).select("id");
  if (res.error) throw res.error;
  return res.data.length > 0;
}
```

```tsx
// app/results/[id]/page.tsx
import { redirect, notFound } from "next/navigation";
import { getCreator } from "@/src/auth/session";
import { getSubmission, markViewed } from "@/src/db/queries/submissions";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { logEvent } from "@/src/feedback/events";
import { WaitingState } from "@/components/WaitingState";
import { ResultsView } from "@/components/ResultsView";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const creator = await getCreator();
  if (!creator) redirect(`/?next=/results/${id}`);
  const sub = await getSubmission(id);
  if (!sub || sub.creator_id !== creator.id) notFound();

  if (sub.status !== "ready") return <WaitingState submissionId={id} />;

  if (await markViewed(id)) {
    await logEvent({ name: "recommendations_viewed", creatorId: creator.id, submissionId: id });
  }
  const recs = (await listRecommendations(id)).map((r) => ({
    rank: r.rank, direction_label: r.direction_label, title: r.title, artist: r.artist,
    start_seconds: Number(r.start_seconds), end_seconds: Number(r.end_seconds),
    explanation: r.explanation, artwork_url: r.artwork_url, preview_url: r.preview_url, spotify_url: r.spotify_url,
  }));
  return <ResultsView submissionId={id} recommendations={recs} />;
}
```

```tsx
// components/ResultsView.tsx
"use client";
import { useState } from "react";
import { RecommendationCard } from "@/components/RecommendationCard";
import type { RecommendationView } from "@/app/api/submissions/[id]/route";

export function ResultsView({ submissionId, recommendations }: { submissionId: string; recommendations: RecommendationView[] }) {
  // Phase 4 replaces these local-state handlers with calls to /api/submissions/[id]/feedback.
  const [selected, setSelected] = useState<number | null>(null);
  const [rejected, setRejected] = useState<Set<number>>(new Set());
  void submissionId;

  const visible = selected === null ? recommendations : recommendations.filter((r) => r.rank === selected);
  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your Songfit</h1>
      <p className="mt-1 text-sm text-ink/60">Three songs that fit this video. Tap one to use it.</p>
      <div className="mt-6 flex flex-col gap-4">
        {visible.map((r) => (
          <RecommendationCard
            key={r.rank}
            rec={r}
            featured={r.rank === 1}
            state={selected === r.rank ? "selected" : rejected.has(r.rank) ? "rejected" : "idle"}
            onSelect={(rank) => setSelected(rank)}
            onReject={(rank) => setRejected((s) => new Set(s).add(rank))}
          />
        ))}
      </div>
    </main>
  );
}
```

```tsx
// components/RecommendationCard.tsx
"use client";
import { useRef, useState } from "react";
import { formatTime } from "@/src/shared/format";
import type { RecommendationView } from "@/app/api/submissions/[id]/route";

type Props = {
  rec: RecommendationView;
  featured: boolean;
  state: "idle" | "selected" | "rejected";
  onSelect: (rank: number) => void;
  onReject: (rank: number) => void;
};

export function RecommendationCard({ rec, featured, state, onSelect, onReject }: Props) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); } else { void el.play(); setPlaying(true); }
  };

  return (
    <article
      className={[
        "rounded-2xl border border-ink/10 bg-white p-4 shadow-sm transition",
        featured ? "p-5" : "",
        state === "rejected" ? "opacity-40" : "",
      ].join(" ")}
    >
      <div className="flex gap-4">
        {rec.artwork_url ? (
          <img src={rec.artwork_url} alt="" className={featured ? "h-24 w-24 rounded-xl object-cover" : "h-16 w-16 rounded-lg object-cover"} />
        ) : (
          <div className={featured ? "h-24 w-24 rounded-xl bg-ink/5" : "h-16 w-16 rounded-lg bg-ink/5"} />
        )}
        <div className="min-w-0 flex-1">
          <span className="inline-block rounded-full bg-steel/10 px-2 py-0.5 text-xs font-medium text-steel">
            #{rec.rank} {rec.direction_label}
          </span>
          <h2 className={featured ? "mt-1 truncate text-lg font-semibold text-ink" : "mt-1 truncate font-semibold text-ink"}>{rec.title}</h2>
          <p className="truncate text-sm text-ink/60">{rec.artist}</p>
          <p className="mt-2 text-base font-bold text-ink">
            Use {formatTime(rec.start_seconds)}–{formatTime(rec.end_seconds)}
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink/80">{rec.explanation}</p>

      <div className="mt-3 flex items-center gap-3 text-sm">
        {rec.preview_url && (
          <>
            <audio ref={audio} src={rec.preview_url} preload="none" onEnded={() => setPlaying(false)} />
            <button type="button" onClick={toggle} className="rounded-full border border-ink/15 px-3 py-1 text-ink">
              {playing ? "Pause preview" : "Play preview"}
            </button>
          </>
        )}
        <a href={rec.spotify_url} target="_blank" rel="noopener noreferrer" className="text-steel underline-offset-2 hover:underline">
          Open in Spotify
        </a>
      </div>

      {state !== "selected" && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onSelect(rec.rank)} className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white">
            Use this
          </button>
          <button type="button" onClick={() => onReject(rec.rank)} className="rounded-xl border border-ink/15 px-4 py-3 text-sm font-medium text-ink">
            Not for me
          </button>
        </div>
      )}
      {state === "selected" && <p className="mt-4 text-sm font-medium text-steel">Chosen. Go make it.</p>}
    </article>
  );
}
```

Tailwind colour tokens `ink` (near-black `#141821`) and `steel` (`#5B7394`) are defined in `tailwind.config.ts` in Phase 0 (Task 0.2). If they are missing, add them there now:

```ts
// tailwind.config.ts → theme.extend.colors
colors: { ink: "#141821", steel: "#5B7394" },
```

- [ ] **Step 7: Check it renders**

Run: `pnpm typecheck && pnpm dev`, then open `/results/<id of a ready submission>` on a phone-width viewport (DevTools, 390 px).
Expected: heading "Your Songfit", three cards with #1 larger, "Use m:ss–m:ss" in bold, a working preview button where a preview exists, "Open in Spotify" opens a Spotify search in a new tab, "Use this" collapses to one card, "Not for me" dims a card. Refreshing does not log a second `recommendations_viewed` event (check the `events` table).

- [ ] **Step 8: Commit**

```bash
git add src/shared/format.ts tests/shared/format.test.ts components/RecommendationCard.tsx components/ResultsView.tsx app/results app/api/submissions src/db/queries/submissions.ts tailwind.config.ts
git commit -m "Add results page with recommendation cards and previews"
```

---

### Task 3.12: Admin inspector: candidates and final picks

**Files:**
- Create: `components/admin/CandidatesTable.tsx`
- Modify: `app/admin/submissions/[id]/page.tsx`

**Interfaces:**
- Consumes: `listCandidates` (Task 3.10), `listRecommendations`, `requireAdmin` (Phase 1), the existing inspector page from Phase 2 (video, analysis JSON, brief, transcript).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the table component**

```tsx
// components/admin/CandidatesTable.tsx
import { DIMENSIONS, type ComponentScores } from "@/src/shared/types";
import { formatTime } from "@/src/shared/format";

type Row = {
  id: string; title: string; artist: string; direction: string; verified: boolean;
  proposed_start: number; proposed_end: number; total_score: number | null;
  component_scores: ComponentScores | null; generator_reason: string; deezer_id: string | null;
};

export function CandidatesTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left">
            <th className="p-1">#</th><th className="p-1">Song</th><th className="p-1">Dir</th><th className="p-1">Verified</th>
            <th className="p-1">Section</th><th className="p-1">Total</th>
            {DIMENSIONS.map((d) => <th key={d} className="p-1">{d.slice(0, 4)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.verified ? "" : "text-gray-400"}>
              <td className="p-1">{i + 1}</td>
              <td className="p-1" title={r.generator_reason}>{r.title} — {r.artist}</td>
              <td className="p-1">{r.direction}</td>
              <td className="p-1">{r.verified ? "yes" : "no"}</td>
              <td className="p-1">{formatTime(Number(r.proposed_start))}–{formatTime(Number(r.proposed_end))}</td>
              <td className="p-1 font-mono">{r.total_score === null ? "—" : Number(r.total_score).toFixed(2)}</td>
              {DIMENSIONS.map((d) => {
                const s = r.component_scores?.[d];
                return (
                  <td key={d} className="p-1 font-mono" title={s?.reason ?? ""}>
                    {s ? s.score.toFixed(2) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Add the sections to the inspector page**

In `app/admin/submissions/[id]/page.tsx` (created in Phase 2), import and add after the brief/transcript sections:

```tsx
import { listCandidates } from "@/src/db/queries/candidates";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { CandidatesTable } from "@/components/admin/CandidatesTable";
import { formatTime } from "@/src/shared/format";
import type { ComponentScores } from "@/src/shared/types";

// inside the component, after loading the submission:
const [candidates, recs] = await Promise.all([listCandidates(id), listRecommendations(id)]);

// in the JSX, after the analysis sections:
<section className="mt-8">
  <h2 className="text-lg font-semibold">Final 3</h2>
  {recs.length === 0 ? <p className="text-sm text-gray-500">none yet</p> : (
    <ol className="mt-2 space-y-2 text-sm">
      {recs.map((r) => (
        <li key={r.id}>
          <b>#{r.rank} {r.direction_label}</b>: {r.title} — {r.artist}, use {formatTime(Number(r.start_seconds))}–{formatTime(Number(r.end_seconds))}
          <div className="text-gray-600">{r.explanation}</div>
        </li>
      ))}
    </ol>
  )}
</section>
<section className="mt-8">
  <h2 className="text-lg font-semibold">Candidates ({candidates.length}, {candidates.filter((c) => c.verified).length} verified)</h2>
  <CandidatesTable rows={candidates.map((c) => ({
    id: c.id, title: c.title, artist: c.artist, direction: c.direction, verified: c.verified,
    proposed_start: Number(c.proposed_start), proposed_end: Number(c.proposed_end),
    total_score: c.total_score === null ? null : Number(c.total_score),
    component_scores: c.component_scores as ComponentScores | null,
    generator_reason: c.generator_reason, deezer_id: c.deezer_id,
  }))} />
</section>
```

- [ ] **Step 3: Check it renders**

Run: `pnpm typecheck && pnpm dev`, open `/admin/submissions/<id>` as the admin.
Expected: a "Final 3" list and a candidates table sorted by total with unverified rows greyed out; hovering a score cell shows its reason.

- [ ] **Step 4: Commit**

```bash
git add components/admin/CandidatesTable.tsx app/admin/submissions
git commit -m "Show candidates with component scores and final picks in admin inspector"
```

---

### Phase 3 demo check

Do this with real keys in `.env.local` and the local Supabase running.

- [ ] 1. Upload a real 20–60 s Reel from the upload screen (Phase 1 flow). Note the submission id from the URL.
- [ ] 2. Watch `pnpm dev` logs: `verifyCandidates { total: ~70, verified: ~55-65 }`, then `recommendations_ready` with `ms`. Record elapsed time. Target: under 120 s.
- [ ] 3. Results page: 3 real songs. For each, open the Spotify link and confirm the song exists by that artist. Confirm `start_seconds < end_seconds <= duration_seconds` (check in admin). Play each preview.
- [ ] 4. Admin inspector: candidates table shows roughly 60 scored rows plus greyed unverified rows; the three directions are all represented among verified rows; scores are not all identical (if they cluster at 0.7, tighten the scoring prompt's "use the full range" instruction and bump `PROMPT_VERSION` to `scoring-v2`).
- [ ] 5. Cost: from the Anthropic console, record tokens for this run. Expected order of magnitude: 3 candidate calls (~4k out each), 1 scoring call (~15k in / 8k out), 1 explain call. Write the per-run cost and elapsed time into `docs/RESEARCH.md` under a new dated entry "First end-to-end run".
- [ ] 6. Run the whole suite: `pnpm typecheck && pnpm test`. Expected: all green.
- [ ] 7. Commit any prompt tweaks with bumped `PROMPT_VERSION` constants.
