## Phase 3 — Engine → results

**Demo when done:** upload a real video → about 90 s later the results page shows 3 real songs with sections and reasons; the admin inspector shows ~60 scored candidates. Previews are hidden unless `PREVIEWS_ENABLED` is flipped (ruling C8).

Tasks are ordered by dependency: normalisation first (everything matches on it), then candidates, catalog, scoring, diversify, sections, explain, the orchestrator, and finally UI.

This phase was rewritten after the Codex review (`docs/review/02-codex-review.md`, rulings in `docs/review/03-claude-rulings.md`): C1, C3, C5, C6, I1, I3, I4, I5, I7, I8, I9, I10, M1 apply here.

Conventions for every task in this phase:
- Imports use the `@/` alias (`@/src/shared/types`), which Next.js maps to the repo root.
- Model calls go through `callClaude` from `src/shared/anthropic.ts` (Phase 0, Task 0.2):
  ```ts
  export type ClaudeCall = (args: { model: string; system: string; user: string; maxTokens?: number; timeoutMs?: number }) => Promise<string>;
  export const callClaude: ClaudeCall;
  ```
  `callClaude` itself logs `model.call` with model, latency, input/output tokens and stop reason (Phase 2.3b owns that). Stages log their own `{ stage, ms, chars }` line. Each model-backed stage takes an optional `deps` argument so tests inject a stub instead of mocking modules.
- `extractJson(text: string): unknown` from `src/shared/json.ts` (Phase 2, Task 2.3) strips fences, finds the first `{` or `[`, `JSON.parse`s, and throws with the raw text attached. Stages call `extractJson` then Zod. **No per-item dropping, no fabricated defaults**: a response that fails validation is retried once with the Zod error appended to the user prompt, then the stage fails with `PipelineError(stage, message, raw)` (ruling C1).
- `PipelineError` from `src/shared/errors.ts` (Phase 0): `new PipelineError(stage: string, message: string, raw?: string)`.
- Generated DB types: `CandidateInsert` / `CandidateRow` from `src/db/queries/candidates.ts`, `RecommendationInsert` / `RecommendationRow` from `src/db/queries/recommendations.ts` (Phase 0, Task 0.4; aliases of `Database["public"]["Tables"][…]["Insert" | "Row"]`).
- `p-limit` is a dependency (Phase 0, Task 0.1).
- Tests live in `tests/` mirroring `src/`, run with `pnpm test -- <path>`. Shared fixtures `analysis` and `brief` are exported from `tests/engine/fixtures.ts` (created in Task 3.2).

---

### Task 3.1: Title and artist normalisation (conservative matching)

**Files:**
- Create: `src/engine/catalog/normalize.ts`
- Test: `tests/engine/catalog/normalize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export function normalizeTitle(s: string): string;       // folded, featuring stripped, version words kept
  export function versionTags(title: string): Set<string>; // {"live","remix","acoustic","sped up","slowed","instrumental","karaoke","cover","demo","radio edit","remaster","extended","version"}
  export function normalizeArtist(s: string): string;      // primary artist, featuring stripped; never split on "and"/"&"
  export function normalizeKey(title: string, artist: string): string; // `${normalizeTitle}|${normalizeArtist}` (version words removed from title part)
  export function titlesMatch(a: string, b: string): boolean;  // EQUALITY after removing version words, AND same version tags (ignoring remaster/radio edit)
  export function artistsMatch(a: string, b: string): boolean;
  ```

Ruling I3: no prefix matching, versions must agree, "and"/"&" are part of band names, diacritics are folded for comparison only (never ASCII-stripped away: non-Latin scripts survive).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/catalog/normalize.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeTitle, normalizeArtist, normalizeKey, titlesMatch, artistsMatch, versionTags,
} from "@/src/engine/catalog/normalize";

describe("normalizeTitle", () => {
  it("lowercases, folds diacritics and collapses punctuation", () => {
    expect(normalizeTitle("Don't Stop Me Now!")).toBe("don t stop me now");
    expect(normalizeTitle("Señorita")).toBe("senorita");
  });
  it("strips featuring clauses only", () => {
    expect(normalizeTitle("Industry Baby (feat. Jack Harlow)")).toBe("industry baby");
    expect(normalizeTitle("Industry Baby feat. Jack Harlow")).toBe("industry baby");
  });
  it("keeps version words", () => {
    expect(normalizeTitle("Stay (Sped Up)")).toBe("stay sped up");
    expect(normalizeTitle("Blinding Lights - Remastered")).toBe("blinding lights remastered");
  });
  it("keeps non-Latin scripts", () => {
    expect(normalizeTitle("夜に駆ける")).toBe("夜に駆ける");
  });
});

describe("versionTags", () => {
  it("extracts tags from anywhere in the title", () => {
    expect([...versionTags("Stay (Sped Up)")]).toEqual(["sped up"]);
    expect([...versionTags("Blinding Lights - Live at the O2")]).toEqual(["live"]);
    expect([...versionTags("Blinding Lights")]).toEqual([]);
  });
});

describe("normalizeArtist", () => {
  it("keeps the primary artist and strips featuring", () => {
    expect(normalizeArtist("Drake feat. Rihanna")).toBe("drake");
    expect(normalizeArtist("Jawsh 685 featuring Jason Derulo")).toBe("jawsh 685");
  });
  it("never splits on and / & / x / commas", () => {
    expect(normalizeArtist("Florence + The Machine")).toBe("florence the machine");
    expect(normalizeArtist("Simon & Garfunkel")).toBe("simon garfunkel");
    expect(normalizeArtist("Of Monsters and Men")).toBe("of monsters and men");
  });
  it("folds diacritics and keeps non-Latin names", () => {
    expect(normalizeArtist("Beyoncé")).toBe("beyonce");
    expect(normalizeArtist("YOASOBI")).toBe("yoasobi");
    expect(normalizeArtist("宇多田ヒカル")).toBe("宇多田ヒカル");
  });
});

describe("matching (10 fixtures)", () => {
  const cases: [string, string, boolean][] = [
    ["Blinding Lights", "Blinding Lights - Remastered", true],
    ["Blinding Lights", "Blinding Lights (Radio Edit)", true],
    ["Stay", "Stay With Me", false],
    ["Stay (Sped Up)", "Stay", false],
    ["Stay", "Stay (Live)", false],
    ["Blinding Lights", "Save Your Tears", false],
    ["Industry Baby", "Industry Baby (feat. Jack Harlow)", true],
    ["Running Up That Hill", "Running Up That Hill (A Deal With God)", false],
    ["夜に駆ける", "夜に駆ける", true],
    ["", "", false],
  ];
  it.each(cases)("titlesMatch(%s, %s) = %s", (a, b, expected) => {
    expect(titlesMatch(a, b)).toBe(expected);
  });
  it("artistsMatch compares primary artists", () => {
    expect(artistsMatch("Beyoncé", "Beyonce")).toBe(true);
    expect(artistsMatch("Drake feat. Rihanna", "Drake")).toBe(true);
    expect(artistsMatch("Drake", "Rihanna")).toBe(false);
    expect(artistsMatch("Florence + The Machine", "Florence + the Machine")).toBe(true);
    expect(artistsMatch("宇多田ヒカル", "宇多田ヒカル")).toBe(true);
  });
  it("normalizeKey drops version words so dedupe treats edits as one song", () => {
    expect(normalizeKey("Blinding Lights - Remastered", "The Weeknd")).toBe("blinding lights|the weeknd");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/catalog/normalize.test.ts`
Expected: FAIL, "Cannot find module '@/src/engine/catalog/normalize'".

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/normalize.ts
// Conservative string matching (ruling I3). Both sides of every comparison go through the same
// functions. We fold case/diacritics and punctuation, strip featuring credits, and keep version
// words so "Stay (Sped Up)" never matches "Stay".

const VERSION_WORDS = [
  "sped up", "radio edit", "live", "remix", "acoustic", "slowed", "instrumental",
  "karaoke", "cover", "demo", "remastered", "remaster", "extended", "version",
] as const;
const SAME_RECORDING = new Set(["remaster", "radio edit"]); // same take, different master/cut

const FEAT_PAREN_RE = /\s*[(\[][^)\]]*\b(?:feat\.?|ft\.?|featuring|with)\b[^)\]]*[)\]]/gi;
const FEAT_TAIL_RE = /\s+\b(?:feat\.?|ft\.?|featuring)\b\s+.*$/i;

/** Lowercase, fold combining marks, keep letters/digits of any script, collapse the rest to spaces. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeTitle(s: string): string {
  return fold(s.replace(FEAT_PAREN_RE, "").replace(FEAT_TAIL_RE, ""));
}

export function versionTags(title: string): Set<string> {
  const t = fold(title);
  const tags = new Set<string>();
  for (const w of VERSION_WORDS) {
    if (new RegExp(`(^|\\s)${w}(\\s|$)`).test(t)) tags.add(w === "remastered" ? "remaster" : w);
  }
  return tags;
}

function stripVersionWords(normalized: string): string {
  let out = normalized;
  for (const w of VERSION_WORDS) out = out.replace(new RegExp(`(^|\\s)${w}(?=\\s|$)`, "g"), " ");
  return out.replace(/\s+/g, " ").trim();
}

export function normalizeArtist(s: string): string {
  return fold(s.replace(FEAT_PAREN_RE, "").replace(FEAT_TAIL_RE, ""));
}

export function normalizeKey(title: string, artist: string): string {
  return `${stripVersionWords(normalizeTitle(title))}|${normalizeArtist(artist)}`;
}

function comparableTags(title: string): Set<string> {
  const tags = versionTags(title);
  for (const t of SAME_RECORDING) tags.delete(t);
  return tags;
}

export function titlesMatch(a: string, b: string): boolean {
  const na = stripVersionWords(normalizeTitle(a));
  const nb = stripVersionWords(normalizeTitle(b));
  if (!na || !nb || na !== nb) return false;
  const ta = comparableTags(a);
  const tb = comparableTags(b);
  if (ta.size !== tb.size) return false;
  for (const t of ta) if (!tb.has(t)) return false;
  return true;
}

export function artistsMatch(a: string, b: string): boolean {
  const na = normalizeArtist(a);
  const nb = normalizeArtist(b);
  return !!na && !!nb && na === nb;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/catalog/normalize.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/normalize.ts tests/engine/catalog/normalize.test.ts
git commit -m "Add conservative title and artist normalisation for song matching"
```

---

### Task 3.2: Candidate generation (three directions, merged memberships)

**Files:**
- Create: `tests/engine/fixtures.ts`, `src/engine/candidates/generateCandidates.ts`
- Test: `tests/engine/candidates/generateCandidates.test.ts`

**Interfaces:**
- Consumes: `MusicBrief`, `VideoAnalysis`, `GeneratedCandidate`, `DirectionTag` from `@/src/shared/types`; `MODELS`, `LIMITS` from `@/src/shared/config`; `callClaude`, `ClaudeCall`; `extractJson`; `normalizeKey` (Task 3.1).
- Produces:
  ```ts
  export const PROMPT_VERSION = "candidates-v2";
  export type GenerateOpts = { note?: string; exclude?: string[]; call?: ClaudeCall };
  export function buildCandidatePrompt(direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis, opts?: { note?: string; exclude?: string[] }): string;
  export function parseCandidateList(text: string, direction: DirectionTag): { ok: true; items: GeneratedCandidate[] } | { ok: false; error: string };
  export function mergeCandidates(lists: GeneratedCandidate[][]): GeneratedCandidate[]; // dedupe by normalizeKey, union of directions
  export async function generateCandidates(brief: MusicBrief, analysis: VideoAnalysis, opts?: GenerateOpts): Promise<GeneratedCandidate[]>;
  ```

Rulings: C1 (whole-list validation, one retry, then fail), I4 (`exclude` for regeneration), I9 (`directions` keeps every membership; `anchor_seconds` and `section_is_vocal` are explicit fields).

- [ ] **Step 1: Write the shared fixtures**

```ts
// tests/engine/fixtures.ts
import type { MusicBrief, VideoAnalysis, GeneratedCandidate, VerifiedCandidate, ScoredCandidate, Pick } from "@/src/shared/types";

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

export const gen = (over: Partial<GeneratedCandidate> = {}): GeneratedCandidate => ({
  title: "Blinding Lights", artist: "The Weeknd", proposed_start: 43, proposed_end: 58,
  anchor_seconds: 45, section_is_vocal: true, section_reason: "chorus entry",
  fit_reason: "fits the night drive", directions: ["safe"], ...over,
});

export const ver = (over: Partial<VerifiedCandidate> = {}): VerifiedCandidate => ({
  ...gen(), deezer_id: "1", canonical_title: "Blinding Lights", canonical_artist: "The Weeknd",
  duration_seconds: 200, artwork_url: null, deezer_url: "https://www.deezer.com/track/1", preview_url: null, ...over,
});

const one = { score: 0.7, reason: "r" };
export const scored = (over: Partial<ScoredCandidate> = {}): ScoredCandidate => ({
  ...ver(), total_score: 0.7,
  component_scores: { semantic: one, emotional: one, aesthetic: one, pacing: one, dialogue: one, cultural: one, originality: one },
  ...over,
});

export const pick = (over: Partial<Pick> = {}): Pick => ({
  ...scored(), rank: 1, direction_label: "Best fit", start_seconds: 43, end_seconds: 58, aligned_to_moment: null, ...over,
});
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/engine/candidates/generateCandidates.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  mergeCandidates, parseCandidateList, generateCandidates, buildCandidatePrompt,
} from "@/src/engine/candidates/generateCandidates";
import { analysis, brief, gen } from "../fixtures";

const item = (title: string, artist = "X") => ({
  title, artist, proposed_start: 10, proposed_end: 25, anchor_seconds: 12, section_is_vocal: true,
  section_reason: "s", fit_reason: "f",
});

describe("mergeCandidates", () => {
  it("dedupes by normalised key and unions directions in first-seen order", () => {
    const out = mergeCandidates([
      [gen({ title: "Blinding Lights", directions: ["safe"] })],
      [gen({ title: "blinding lights - remastered", directions: ["current"] }), gen({ title: "Save Your Tears", directions: ["current"] })],
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.directions).toEqual(["safe", "current"]);
    expect(out[0]!.title).toBe("Blinding Lights");
    expect(out[1]!.directions).toEqual(["current"]);
  });
});

describe("parseCandidateList", () => {
  it("accepts a fenced array and stamps the direction", () => {
    const r = parseCandidateList("```json\n" + JSON.stringify([item("A")]) + "\n```", "unexpected");
    expect(r.ok && r.items[0]!.directions).toEqual(["unexpected"]);
  });
  it("rejects the whole list when any item is malformed", () => {
    const r = parseCandidateList(JSON.stringify([item("A"), { title: "Bad", artist: "C" }]), "safe");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/proposed_start|anchor_seconds|section_is_vocal/);
  });
  it("rejects prose", () => {
    expect(parseCandidateList("sorry, no", "safe").ok).toBe(false);
  });
});

describe("generateCandidates", () => {
  it("makes three calls and merges results", async () => {
    const call = vi.fn(async ({ user }: { user: string }) => {
      const dir = user.includes("DIRECTION: safe") ? "safe" : user.includes("DIRECTION: current") ? "current" : "unexpected";
      return JSON.stringify([item(`${dir} song`), item("Shared Song", "Y")]);
    });
    const out = await generateCandidates(brief, analysis, { call });
    expect(call).toHaveBeenCalledTimes(3);
    expect(out.map((c) => c.title).sort()).toEqual(["Shared Song", "current song", "safe song", "unexpected song"]);
    expect(out.find((c) => c.title === "Shared Song")!.directions).toEqual(["safe", "current", "unexpected"]);
  });
  it("retries a direction once with the validation error, then fails", async () => {
    const call = vi.fn(async ({ user }: { user: string }) =>
      user.includes("DIRECTION: safe") ? JSON.stringify([{ title: "Bad" }]) : JSON.stringify([item("ok")]));
    await expect(generateCandidates(brief, analysis, { call })).rejects.toThrow(/candidate output invalid/);
    const safeCalls = call.mock.calls.filter((c) => (c[0] as { user: string }).user.includes("DIRECTION: safe"));
    expect(safeCalls).toHaveLength(2);
    expect((safeCalls[1]![0] as { user: string }).user).toMatch(/PREVIOUS OUTPUT WAS INVALID/);
  });
  it("includes the note and the exclusion list when given", () => {
    const p = buildCandidatePrompt("safe", brief, analysis, { note: "avoid previous list", exclude: ["stay|the kid laroi"] });
    expect(p).toContain("avoid previous list");
    expect(p).toContain("stay|the kid laroi");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/candidates/generateCandidates.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write the implementation**

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
import { logger } from "@/src/shared/logger";
import { normalizeKey } from "@/src/engine/catalog/normalize";

export const PROMPT_VERSION = "candidates-v2";

export type GenerateOpts = { note?: string; exclude?: string[]; call?: ClaudeCall };

const SYSTEM = `You are Songfit's music supervisor for short-form video (Instagram Reels, TikTok).
You know mainstream, independent and viral music across decades, and you know which songs
creators actually use on these platforms. You only ever name REAL, officially released songs by
the original artist that are very likely available in the Instagram and TikTok music libraries
in the United States. Never invent songs. Never suggest AI-generated music, unreleased tracks,
remixes by unknown accounts, or production-library stock music. Name the original studio
recording, not a live, sped-up, slowed, acoustic or remix version.`;

const DIRECTION_BRIEF: Record<DirectionTag, string> = {
  safe: "Recognisable, proven fits for this kind of content: songs a creator in this niche has seen work many times. Mainstream enough to be in both libraries.",
  current: "Songs you believe have been popular on Instagram Reels and TikTok within the last 12 months, or trending-adjacent artists having a moment. Still real, released and easy to find. You are not told what is trending today; use your best knowledge.",
  unexpected: "Less obvious: older songs, niche genres, deep cuts from known artists, genre-crossing picks that a tasteful editor would reach for. Must still be real, released and findable in the libraries.",
};

export function buildCandidatePrompt(
  direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis,
  opts: { note?: string; exclude?: string[] } = {},
): string {
  const moments = analysis.important_moments
    .map((m) => `- ${m.time.toFixed(1)}s: ${m.type}${m.note ? ` (${m.note})` : ""}`)
    .join("\n") || "- none identified";
  const exclude = opts.exclude?.length
    ? `\nDO NOT propose any of these (title|artist keys): ${opts.exclude.join("; ")}\n`
    : "";
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
Spoken dialogue present: ${analysis.dialogue_present ? "YES — sung vocals will compete with the speech; prefer sections without lead vocals" : "no"}
Key moments:
${moments}

MUSIC BRIEF
${brief.text}
Fields: ${JSON.stringify(brief.fields)}
${opts.note ? `\nNOTE: ${opts.note}\n` : ""}${exclude}
TASK
Propose exactly ${LIMITS.candidatesPerDirection} songs for this direction. For each song choose the single
best ${LIMITS.sectionMin}–${LIMITS.sectionMax} second window of the ORIGINAL studio recording for this video.
- anchor_seconds: the second where the song's defining musical moment happens inside that window
  (chorus entry, drop, the lift). Be as accurate as you can; if unsure, say so in section_reason.
- proposed_start / proposed_end: the window, in seconds, containing anchor_seconds.
- section_is_vocal: true if lead vocals are singing during most of the window.

Return ONLY a JSON array, no prose, each item exactly:
{
  "title": string,
  "artist": string,
  "proposed_start": number,
  "proposed_end": number,
  "anchor_seconds": number,
  "section_is_vocal": boolean,
  "section_reason": string,   // what happens musically at the anchor and across the window (one sentence)
  "fit_reason": string        // why it fits THIS video, referencing something specific in it (one sentence)
}`;
}

const Item = GeneratedCandidate.omit({ directions: true });
const ItemList = z.array(Item).min(1);

export function parseCandidateList(
  text: string, direction: DirectionTag,
): { ok: true; items: GeneratedCandidate[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "no JSON found" };
  }
  const parsed = ItemList.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, items: parsed.data.map((i) => ({ ...i, directions: [direction] })) };
}

export function mergeCandidates(lists: GeneratedCandidate[][]): GeneratedCandidate[] {
  const byKey = new Map<string, GeneratedCandidate>();
  for (const list of lists) {
    for (const c of list) {
      const key = normalizeKey(c.title, c.artist);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...c, directions: [...c.directions] });
        continue;
      }
      for (const d of c.directions) if (!existing.directions.includes(d)) existing.directions.push(d);
    }
  }
  return [...byKey.values()];
}

async function generateDirection(
  direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis, opts: GenerateOpts, call: ClaudeCall,
): Promise<GeneratedCandidate[]> {
  const user = buildCandidatePrompt(direction, brief, analysis, opts);
  const started = Date.now();
  const first = await call({ model: MODELS.candidates, system: SYSTEM, user, maxTokens: 6000, timeoutMs: LIMITS.modelTimeoutMs });
  const r1 = parseCandidateList(first, direction);
  if (r1.ok) {
    logger.info("candidates.direction", { direction, ms: Date.now() - started, items: r1.items.length });
    return r1.items;
  }
  logger.warn("candidates.retry", { direction, error: r1.error.slice(0, 300) });
  const retryUser = `${user}\n\nPREVIOUS OUTPUT WAS INVALID. Validation error:\n${r1.error.slice(0, 2000)}\nReturn the full corrected JSON array.`;
  const second = await call({ model: MODELS.candidates, system: SYSTEM, user: retryUser, maxTokens: 6000, timeoutMs: LIMITS.modelTimeoutMs });
  const r2 = parseCandidateList(second, direction);
  if (r2.ok) return r2.items;
  throw new PipelineError("recommend", `candidate output invalid (${direction}): ${r2.error.slice(0, 200)}`, second);
}

export async function generateCandidates(
  brief: MusicBrief, analysis: VideoAnalysis, opts: GenerateOpts = {},
): Promise<GeneratedCandidate[]> {
  const call = opts.call ?? callClaude;
  const lists = await Promise.all(
    DirectionTag.options.map((direction) => generateDirection(direction, brief, analysis, opts, call)),
  );
  return mergeCandidates(lists);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/candidates/generateCandidates.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && git add src/engine/candidates tests/engine/candidates tests/engine/fixtures.ts
git commit -m "Add three-direction candidate generation with strict parsing and merged memberships"
```

---
### Task 3.3: Deezer search with bounded concurrency, timeouts and provider errors

**Files:**
- Create: `src/engine/catalog/deezer.ts`
- Test: `tests/engine/catalog/deezer.test.ts`

**Interfaces:**
- Consumes: `LIMITS.deezerConcurrency`, `LIMITS.deezerTimeoutMs`; `titlesMatch`, `artistsMatch` (Task 3.1); `p-limit`.
- Produces:
  ```ts
  export type DeezerTrack = { id: number; title: string; duration: number; preview: string | null; link: string; artist: { name: string }; album?: { cover_medium?: string | null; cover_big?: string | null } };
  export class ProviderError extends Error { constructor(message: string, readonly status?: number) }
  export const deezerLimit: ReturnType<typeof pLimit>;                 // shared p-limit(LIMITS.deezerConcurrency)
  export async function deezerGet(url: string, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>): Promise<unknown>; // timeout + retry/backoff; throws ProviderError
  export async function searchDeezer(title: string, artist: string, fetchImpl?: typeof fetch): Promise<DeezerTrack[]>;
  export function pickDeezerMatch(cand: { title: string; artist: string }, results: DeezerTrack[]): DeezerTrack | null;
  export async function findDeezerMatch(cand: { title: string; artist: string }, fetchImpl?: typeof fetch): Promise<DeezerTrack | null>; // throws ProviderError on outage
  ```

Ruling I5: no in-process token bucket (it does not survive multiple Vercel instances); bounded concurrency + per-request timeout + backoff on 429/5xx instead. Provider outages are distinguished from "no such song".

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/catalog/deezer.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  deezerGet, pickDeezerMatch, searchDeezer, findDeezerMatch, ProviderError, type DeezerTrack,
} from "@/src/engine/catalog/deezer";

const track = (over: Partial<DeezerTrack> = {}): DeezerTrack => ({
  id: 1, title: "Blinding Lights", duration: 200, preview: "https://p/1.mp3",
  link: "https://www.deezer.com/track/1", artist: { name: "The Weeknd" },
  album: { cover_medium: "m.jpg", cover_big: "b.jpg" }, ...over,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("deezerGet", () => {
  it("retries 429 and 5xx with backoff, then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ data: [] }));
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const out = await deezerGet("https://api.deezer.com/x", fetchImpl as unknown as typeof fetch, sleep);
    expect(out).toEqual({ data: [] });
    expect(sleeps).toEqual([500, 1500]);
  });
  it("throws ProviderError after 3 failed attempts", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
    await expect(deezerGet("https://api.deezer.com/x", fetchImpl as unknown as typeof fetch, async () => {}))
      .rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("wraps network errors as ProviderError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(deezerGet("https://api.deezer.com/x", fetchImpl as unknown as typeof fetch, async () => {}))
      .rejects.toBeInstanceOf(ProviderError);
  });
});

describe("pickDeezerMatch", () => {
  it("returns the first ACCEPTABLE result (same version, same primary artist)", () => {
    const results = [
      track({ id: 9, title: "Blinding Lights", artist: { name: "Karaoke Hits" } }),
      track({ id: 3, title: "Blinding Lights (Live)", artist: { name: "The Weeknd" } }),
      track({ id: 2, title: "Blinding Lights - Remastered", artist: { name: "The Weeknd" } }),
    ];
    expect(pickDeezerMatch({ title: "Blinding Lights", artist: "The Weeknd" }, results)?.id).toBe(2);
  });
  it("returns null when nothing is acceptable", () => {
    expect(pickDeezerMatch({ title: "Stay", artist: "The Kid LAROI" }, [track({ title: "Stay With Me", artist: { name: "The Kid LAROI" } })])).toBeNull();
  });
});

describe("findDeezerMatch", () => {
  it("falls through to the plain query when the strict query has no acceptable match", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const data = u.includes("artist%3A") ? [track({ title: "Blinding Lights (Live)" })] : [track({})];
      return json({ data });
    });
    const out = await findDeezerMatch({ title: "Blinding Lights", artist: "The Weeknd" }, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out?.id).toBe(1);
  });
  it("propagates ProviderError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 503));
    await expect(findDeezerMatch({ title: "A", artist: "B" }, fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(ProviderError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/catalog/deezer.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/deezer.ts
// Deezer's public search API: no auth, community-documented ~50 req / 5 s per IP (docs/RESEARCH.md).
// We treat that as an assumption, not an SLA: bounded concurrency, timeouts, backoff on 429/5xx.
import { z } from "zod";
import pLimit from "p-limit";
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
    .object({ cover_medium: z.string().nullable().optional(), cover_big: z.string().nullable().optional() })
    .optional(),
});
const DeezerSearchSchema = z.object({ data: z.array(DeezerTrackSchema).default([]) });
export type DeezerTrack = z.infer<typeof DeezerTrackSchema>;

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

export const deezerLimit = pLimit(LIMITS.deezerConcurrency);

const BACKOFF_MS = [500, 1500, 4000];
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET with timeout and retry on 429/5xx/network. Resolves the parsed JSON or throws ProviderError. */
export async function deezerGet(
  url: string, fetchImpl: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<unknown> {
  let last: ProviderError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(LIMITS.deezerTimeoutMs) });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) {
        last = new ProviderError(`deezer ${res.status}`, res.status);
      } else {
        throw new ProviderError(`deezer ${res.status}`, res.status); // 4xx other than 429: do not retry
      }
    } catch (e) {
      if (e instanceof ProviderError && e.status && e.status < 500 && e.status !== 429) throw e;
      last = e instanceof ProviderError ? e : new ProviderError(e instanceof Error ? e.message : String(e));
    }
    if (attempt < 2) await sleep(BACKOFF_MS[attempt]!);
  }
  throw last ?? new ProviderError("deezer: unknown failure");
}

async function query(q: string, fetchImpl: typeof fetch): Promise<DeezerTrack[]> {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`;
  const body = await deezerLimit(() => deezerGet(url, fetchImpl));
  const parsed = DeezerSearchSchema.safeParse(body);
  return parsed.success ? parsed.data.data : [];
}

export async function searchDeezer(title: string, artist: string, fetchImpl: typeof fetch = fetch): Promise<DeezerTrack[]> {
  return query(`artist:"${artist}" track:"${title}"`, fetchImpl);
}

export function pickDeezerMatch(cand: { title: string; artist: string }, results: DeezerTrack[]): DeezerTrack | null {
  for (const r of results) {
    if (titlesMatch(cand.title, r.title) && artistsMatch(cand.artist, r.artist.name)) return r;
  }
  return null;
}

/** Strict search first; if it yields no ACCEPTABLE match, try the plain query. Throws ProviderError on outage. */
export async function findDeezerMatch(
  cand: { title: string; artist: string }, fetchImpl: typeof fetch = fetch,
): Promise<DeezerTrack | null> {
  const strict = pickDeezerMatch(cand, await searchDeezer(cand.title, cand.artist, fetchImpl));
  if (strict) return strict;
  const plain = await query(`${cand.title} ${cand.artist}`, fetchImpl);
  return pickDeezerMatch(cand, plain);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/catalog/deezer.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/deezer.ts tests/engine/catalog/deezer.test.ts
git commit -m "Add Deezer search with bounded concurrency, timeouts, backoff and strict matching"
```

---

### Task 3.4: iTunes preview fallback (only when previews are enabled)

**Files:**
- Create: `src/engine/catalog/itunes.ts`
- Test: `tests/engine/catalog/itunes.test.ts`

**Interfaces:**
- Consumes: `titlesMatch`, `artistsMatch`; `PREVIEWS_ENABLED`, `LIMITS.deezerTimeoutMs`.
- Produces: `export async function findItunesPreview(title: string, artist: string, fetchImpl?: typeof fetch): Promise<{ itunesId: string; previewUrl: string | null } | null>` — returns `null` immediately when `PREVIEWS_ENABLED` is false; never throws.

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/catalog/itunes.test.ts
import { describe, it, expect, vi } from "vitest";

const body = {
  results: [
    { trackId: 11, trackName: "Blinding Lights (Karaoke)", artistName: "Karaoke Co", previewUrl: "https://k.m4a" },
    { trackId: 12, trackName: "Blinding Lights", artistName: "The Weeknd", previewUrl: "https://w.m4a" },
  ],
};

describe("findItunesPreview", () => {
  it("returns the matching track's id and preview when previews are enabled", async () => {
    vi.doMock("@/src/shared/config", async (orig) => ({ ...(await orig<object>()), PREVIEWS_ENABLED: true }));
    const { findItunesPreview } = await import("@/src/engine/catalog/itunes");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const out = await findItunesPreview("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch);
    expect(out).toEqual({ itunesId: "12", previewUrl: "https://w.m4a" });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("country=US");
    vi.doUnmock("@/src/shared/config");
    vi.resetModules();
  });
  it("returns null on no match or error, and never throws", async () => {
    vi.doMock("@/src/shared/config", async (orig) => ({ ...(await orig<object>()), PREVIEWS_ENABLED: true }));
    const { findItunesPreview } = await import("@/src/engine/catalog/itunes");
    const bad = vi.fn(async () => new Response("nope", { status: 403 }));
    expect(await findItunesPreview("X", "Y", bad as unknown as typeof fetch)).toBeNull();
    const boom = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await findItunesPreview("X", "Y", boom as unknown as typeof fetch)).toBeNull();
    vi.doUnmock("@/src/shared/config");
    vi.resetModules();
  });
  it("does not call the network when previews are disabled", async () => {
    vi.doMock("@/src/shared/config", async (orig) => ({ ...(await orig<object>()), PREVIEWS_ENABLED: false }));
    const { findItunesPreview } = await import("@/src/engine/catalog/itunes");
    const fetchImpl = vi.fn();
    expect(await findItunesPreview("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.doUnmock("@/src/shared/config");
    vi.resetModules();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/engine/catalog/itunes.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/itunes.ts
// iTunes Search API: free, no auth, ~20 calls/min. Only called for a final pick missing a preview,
// and only when PREVIEWS_ENABLED (ruling C8). Failure never blocks a result.
import { z } from "zod";
import { LIMITS, PREVIEWS_ENABLED } from "@/src/shared/config";
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
  if (!PREVIEWS_ENABLED) return null;
  try {
    const term = encodeURIComponent(`${title} ${artist}`);
    const res = await fetchImpl(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=5&country=US`,
      { signal: AbortSignal.timeout(LIMITS.deezerTimeoutMs) },
    );
    if (!res.ok) return null;
    const parsed = ItunesSearch.safeParse(await res.json());
    if (!parsed.success) return null;
    const hit = parsed.data.results.find((r) => titlesMatch(title, r.trackName) && artistsMatch(artist, r.artistName));
    return hit ? { itunesId: String(hit.trackId), previewUrl: hit.previewUrl ?? null } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/engine/catalog/itunes.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/itunes.ts tests/engine/catalog/itunes.test.ts
git commit -m "Add iTunes preview lookup gated by PREVIEWS_ENABLED"
```

---

### Task 3.5: Verify candidates against Deezer (drop impossible sections, dedupe by recording)

**Files:**
- Create: `src/engine/catalog/verifyCandidates.ts`
- Test: `tests/engine/catalog/verifyCandidates.test.ts`

**Interfaces:**
- Consumes: `GeneratedCandidate`, `VerifiedCandidate`; `findDeezerMatch`, `ProviderError`, `DeezerTrack` (Task 3.3); `PREVIEWS_ENABLED`.
- Produces:
  ```ts
  export function validateSection(start: number, end: number, anchor: number, duration: number): { start: number; end: number } | null;
  export async function verifyCandidates(cands: GeneratedCandidate[], deps?: { find?: typeof findDeezerMatch }): Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }>; // throws ProviderError when ≥30% of lookups hit the provider
  ```

Rulings C6 (no clamp-and-pretend: an anchor past the track end means the model is wrong about the song, drop it), I3 (dedupe by `deezer_id`), I4/I5 (outage ≠ no match).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/catalog/verifyCandidates.test.ts
import { describe, it, expect, vi } from "vitest";
import { validateSection, verifyCandidates } from "@/src/engine/catalog/verifyCandidates";
import { ProviderError, type DeezerTrack } from "@/src/engine/catalog/deezer";
import { gen } from "../fixtures";

describe("validateSection", () => {
  it("leaves a valid window alone", () => {
    expect(validateSection(43, 58, 45, 200)).toEqual({ start: 43, end: 58 });
  });
  it("clamps an end overshoot of at most 1 s", () => {
    expect(validateSection(186, 201, 190, 200)).toEqual({ start: 186, end: 200 });
  });
  it("drops a window that overshoots the track by more than 1 s", () => {
    expect(validateSection(190, 215, 195, 200)).toBeNull();
  });
  it("drops an anchor within 2 s of the end or beyond it", () => {
    expect(validateSection(180, 195, 199, 200)).toBeNull();
    expect(validateSection(180, 195, 250, 200)).toBeNull();
  });
});

const hit = (over: Partial<DeezerTrack> = {}): DeezerTrack => ({
  id: 7, title: "Found", duration: 200, preview: "https://p.mp3", link: "https://d/7",
  artist: { name: "The Weeknd" }, album: { cover_medium: "m.jpg", cover_big: "b.jpg" }, ...over,
});

describe("verifyCandidates", () => {
  it("splits verified/unverified, attaches canonical fields, dedupes by deezer id", async () => {
    const find = vi.fn(async (c: { title: string }) => (c.title.startsWith("Found") ? hit() : null));
    const { verified, unverified } = await verifyCandidates(
      [gen({ title: "Found" }), gen({ title: "Found - Remastered" }), gen({ title: "Missing" })], { find },
    );
    expect(unverified.map((c) => c.title)).toEqual(["Missing"]);
    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatchObject({
      deezer_id: "7", canonical_title: "Found", canonical_artist: "The Weeknd", duration_seconds: 200,
      artwork_url: "b.jpg", deezer_url: "https://d/7", preview_url: null, proposed_start: 43, proposed_end: 58,
    });
  });
  it("drops a verified song whose section is impossible for the real track", async () => {
    const find = vi.fn(async () => hit({ duration: 40 }));
    const { verified, unverified } = await verifyCandidates([gen({ anchor_seconds: 45 })], { find });
    expect(verified).toHaveLength(0);
    expect(unverified).toHaveLength(1);
  });
  it("throws when the provider is failing for 30% or more of lookups", async () => {
    const find = vi.fn(async (c: { title: string }) => {
      if (c.title === "A") throw new ProviderError("deezer 503", 503);
      return hit();
    });
    await expect(verifyCandidates([gen({ title: "A" }), gen({ title: "B" }), gen({ title: "C" })], { find }))
      .rejects.toBeInstanceOf(ProviderError);
  });
  it("tolerates a single provider failure among many", async () => {
    const find = vi.fn(async (c: { title: string }) => {
      if (c.title === "A") throw new ProviderError("deezer 503", 503);
      return hit({ id: Number(c.title.charCodeAt(0)) });
    });
    const { verified } = await verifyCandidates(["A", "B", "C", "D"].map((t) => gen({ title: t })), { find });
    expect(verified).toHaveLength(3);
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
import { PREVIEWS_ENABLED } from "@/src/shared/config";
import { findDeezerMatch, ProviderError } from "@/src/engine/catalog/deezer";
import { logger } from "@/src/shared/logger";

const OUTAGE_RATIO = 0.3;

/**
 * A section is valid only if it fits the real track. We never move an anchor: if the model's
 * musical moment cannot exist in this recording, the candidate is wrong, not the arithmetic.
 */
export function validateSection(
  start: number, end: number, anchor: number, duration: number,
): { start: number; end: number } | null {
  if (duration <= 0) return null;
  if (anchor >= duration - 2) return null;
  if (end > duration + 1) return null;
  return { start: Math.max(0, start), end: Math.min(end, duration) };
}

export async function verifyCandidates(
  cands: GeneratedCandidate[],
  deps: { find?: typeof findDeezerMatch } = {},
): Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }> {
  const find = deps.find ?? findDeezerMatch;
  const verified: VerifiedCandidate[] = [];
  const unverified: GeneratedCandidate[] = [];
  const seenIds = new Set<string>();
  let providerErrors = 0;
  let lastProviderError: ProviderError | null = null;

  // Concurrency is bounded inside deezer.ts (deezerLimit); allSettled keeps one failure from hiding the rest.
  const results = await Promise.allSettled(cands.map((c) => find(c)));

  results.forEach((r, i) => {
    const c = cands[i]!;
    if (r.status === "rejected") {
      if (r.reason instanceof ProviderError) {
        providerErrors++;
        lastProviderError = r.reason;
      } else {
        logger.warn("verifyCandidates.lookup_error", { title: c.title, err: String(r.reason) });
      }
      unverified.push(c);
      return;
    }
    const hit = r.value;
    if (!hit) {
      unverified.push(c);
      return;
    }
    const id = String(hit.id);
    if (seenIds.has(id)) return; // same recording proposed twice under different spellings
    const section = validateSection(c.proposed_start, c.proposed_end, c.anchor_seconds, hit.duration);
    if (!section) {
      logger.info("verifyCandidates.section_impossible", { title: c.title, anchor: c.anchor_seconds, duration: hit.duration });
      unverified.push(c);
      return;
    }
    seenIds.add(id);
    verified.push({
      ...c,
      proposed_start: section.start,
      proposed_end: section.end,
      deezer_id: id,
      canonical_title: hit.title,
      canonical_artist: hit.artist.name,
      duration_seconds: hit.duration,
      artwork_url: hit.album?.cover_big ?? hit.album?.cover_medium ?? null,
      deezer_url: hit.link,
      preview_url: PREVIEWS_ENABLED ? hit.preview : null,
    });
  });

  if (cands.length > 0 && providerErrors / cands.length >= OUTAGE_RATIO && lastProviderError) {
    throw lastProviderError;
  }
  logger.info("verifyCandidates", { total: cands.length, verified: verified.length, providerErrors });
  return { verified, unverified };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/catalog/verifyCandidates.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/verifyCandidates.ts tests/engine/catalog/verifyCandidates.test.ts
git commit -m "Verify candidates against Deezer, drop impossible sections, dedupe by recording"
```

---
### Task 3.6: Scoring (strict batched model dimensions, rules, weights)

**Files:**
- Create: `src/engine/scoring/dimensions.ts`, `src/engine/scoring/modelScores.ts`, `src/engine/scoring/dialogue.ts`, `src/engine/scoring/config/overused.ts`, `src/engine/scoring/overuse.ts`, `src/engine/scoring/weights.ts`, `src/engine/scoring/scoreCandidates.ts`
- Test: `tests/engine/scoring/rules.test.ts`, `tests/engine/scoring/scoreCandidates.test.ts`

**Interfaces:**
- Consumes: `VerifiedCandidate`, `ScoredCandidate`, `ComponentScore`, `ComponentScores`, `Dimension`, `DIMENSIONS`; `callClaude`; `extractJson`; `normalizeKey`; `MODELS.scoring`, `LIMITS.modelTimeoutMs`.
- Produces:
  ```ts
  // dimensions.ts
  export { DIMENSIONS } from "@/src/shared/types";
  export const MODEL_DIMENSIONS = ["semantic","emotional","aesthetic","pacing","cultural","originality"] as const;
  export type ModelDimension = (typeof MODEL_DIMENSIONS)[number];
  // modelScores.ts
  export const PROMPT_VERSION = "scoring-v2";
  export function parseScores(text: string, count: number): { ok: true; scores: Record<ModelDimension, ComponentScore>[] } | { ok: false; error: string };
  export async function modelScores(analysis, brief, cands: VerifiedCandidate[], deps?: { call?: ClaudeCall }): Promise<Record<ModelDimension, ComponentScore>[]>; // aligned with cands; throws PipelineError
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

Rulings C1 (every candidate must be scored or the stage fails), I1 (Sonnet, short reasons, right-sized `max_tokens`), I9 (dialogue rule uses the explicit `section_is_vocal` flag, not prose).

- [ ] **Step 1: Write the failing rule tests**

```ts
// tests/engine/scoring/rules.test.ts
import { describe, it, expect } from "vitest";
import { combine, WEIGHTS } from "@/src/engine/scoring/weights";
import { dialogueScore } from "@/src/engine/scoring/dialogue";
import { overuseScore } from "@/src/engine/scoring/overuse";
import type { ComponentScores, VideoAnalysis } from "@/src/shared/types";
import { analysis, ver } from "../fixtures";

describe("combine", () => {
  it("is a weighted mean", () => {
    const scores = Object.fromEntries(Object.keys(WEIGHTS).map((d) => [d, { score: 0.5, reason: "" }])) as ComponentScores;
    expect(combine(scores)).toBeCloseTo(0.5, 6);
    scores.semantic = { score: 1, reason: "" };
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(combine(scores)).toBeCloseTo((0.5 * (total - WEIGHTS.semantic) + WEIGHTS.semantic) / total, 6);
  });
});

describe("dialogueScore", () => {
  const talky: VideoAnalysis = { ...analysis, dialogue_present: true };
  it("is 1 when there is no dialogue", () => {
    expect(dialogueScore(analysis, ver({ section_is_vocal: true })).score).toBe(1);
  });
  it("penalises vocal sections when there is dialogue", () => {
    expect(dialogueScore(talky, ver({ section_is_vocal: true })).score).toBe(0.3);
  });
  it("passes non-vocal sections under dialogue", () => {
    expect(dialogueScore(talky, ver({ section_is_vocal: false })).score).toBe(1);
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

/** Uses the generator's explicit section_is_vocal flag (ruling I9), never prose matching. */
export function dialogueScore(analysis: VideoAnalysis, cand: VerifiedCandidate): ComponentScore {
  if (!analysis.dialogue_present) return { score: 1, reason: "no dialogue to compete with" };
  if (cand.section_is_vocal) return { score: 0.3, reason: "lead vocals will fight the speech" };
  return { score: 1, reason: "section has no lead vocals under the speech" };
}
```

```ts
// src/engine/scoring/config/overused.ts
// Hand-maintained list of songs saturated on IG/TikTok. Replaced by song_trend_signals later.
// Matching uses normalizeKey, so version suffixes do not matter.
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
  if (KEYS.has(normalizeKey(cand.title, cand.artist))) return { score: 0.4, reason: "overused on social right now" };
  return { score: 1, reason: "not on the overused list" };
}
```

- [ ] **Step 4: Run rule tests to verify they pass**

Run: `pnpm test -- tests/engine/scoring/rules.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing scoreCandidates and modelScores tests**

```ts
// tests/engine/scoring/scoreCandidates.test.ts
import { describe, it, expect, vi } from "vitest";
import { scoreCandidates } from "@/src/engine/scoring/scoreCandidates";
import { modelScores, parseScores, PROMPT_VERSION } from "@/src/engine/scoring/modelScores";
import { DIMENSIONS, type VerifiedCandidate } from "@/src/shared/types";
import { analysis, brief, ver } from "../fixtures";

const vc = (title: string, id: string) => ver({ title, deezer_id: id });
const six = (s: number) => ({
  semantic: { score: s, reason: "a" }, emotional: { score: s, reason: "b" }, aesthetic: { score: s, reason: "c" },
  pacing: { score: s, reason: "d" }, cultural: { score: s, reason: "e" }, originality: { score: s, reason: "f" },
});

describe("scoreCandidates", () => {
  it("attaches all 7 dimensions and sorts by total descending", async () => {
    const scores = vi.fn(async (_a, _b, cands: VerifiedCandidate[]) => cands.map((c) => six(c.title === "Great" ? 0.9 : 0.4)));
    const out = await scoreCandidates(analysis, brief, [vc("Meh", "1"), vc("Great", "2")], { scores });
    expect(out.map((c) => c.title)).toEqual(["Great", "Meh"]);
    for (const c of out) {
      expect(Object.keys(c.component_scores).sort()).toEqual([...DIMENSIONS].sort());
      expect(c.total_score).toBeGreaterThan(0);
    }
  });
});

describe("parseScores", () => {
  it("accepts a complete list", () => {
    const r = parseScores(JSON.stringify([{ index: 0, ...six(0.5) }, { index: 1, ...six(0.6) }]), 2);
    expect(r.ok && r.scores[1]!.semantic.score).toBe(0.6);
  });
  it("rejects a list with a missing index", () => {
    const r = parseScores(JSON.stringify([{ index: 0, ...six(0.5) }]), 2);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/missing index 1/);
  });
  it("rejects an item with an invalid score", () => {
    const bad = { index: 0, ...six(0.5), pacing: { score: 1.7, reason: "x" } };
    expect(parseScores(JSON.stringify([bad]), 1).ok).toBe(false);
  });
});

describe("modelScores", () => {
  it("retries once with the error, then throws", async () => {
    const call = vi.fn(async () => JSON.stringify([{ index: 0, ...six(0.5) }])); // always one short
    await expect(modelScores(analysis, brief, [vc("A", "1"), vc("B", "2")], { call })).rejects.toThrow(/scoring output invalid/);
    expect(call).toHaveBeenCalledTimes(2);
    expect((call.mock.calls[1]![0] as { user: string }).user).toMatch(/PREVIOUS OUTPUT WAS INVALID/);
    expect(PROMPT_VERSION).toBe("scoring-v2");
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
import { MODELS, LIMITS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { MODEL_DIMENSIONS, type ModelDimension } from "@/src/engine/scoring/dimensions";

export const PROMPT_VERSION = "scoring-v2";
const TOKENS_PER_ITEM = 90; // 6 dims × (score + ≤12-word reason) ≈ 90 output tokens

const SYSTEM = `You are Songfit's music supervisor. You score candidate song sections against a specific
short-form video. Be decisive and discriminating: use the full 0–1 range, do not give everything 0.7.
A 1.0 means "this is exactly the song a great editor would pick"; a 0.2 means "clearly wrong".
Reasons are at most 12 words. You must return one object for EVERY candidate index.`;

const DIMENSION_DEFINITIONS: Record<ModelDimension, string> = {
  semantic: "Does the song make sense for what is literally happening in the video (subject, setting, story)?",
  emotional: "Does the emotional character of this section match or productively contrast the video's feel and the creator's intent?",
  aesthetic: "Does the sound match the visual world (luxury vs raw, modern vs retro, polished vs lo-fi)?",
  pacing: "Do the energy and rhythm of this section fit the edit's pace and cuts, and does its musical moment land near the key moment?",
  cultural: "Would this creator realistically use this song on Instagram or TikTok right now, given their niche and audience?",
  originality: "Is it good without being painfully obvious or exhausted?",
};

const Item = z.object({ index: z.number().int().min(0) }).and(
  z.object(Object.fromEntries(MODEL_DIMENSIONS.map((d) => [d, ComponentScore])) as Record<ModelDimension, typeof ComponentScore>),
);

export function buildScoringPrompt(analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[]): string {
  const defs = MODEL_DIMENSIONS.map((d) => `- ${d}: ${DIMENSION_DEFINITIONS[d]}`).join("\n");
  const list = cands
    .map((c, i) => `${i}. "${c.canonical_title}" — ${c.canonical_artist} | section ${c.proposed_start}s–${c.proposed_end}s, anchor ${c.anchor_seconds}s | ${c.section_reason} | proposed because: ${c.fit_reason}`)
    .join("\n");
  const moments = analysis.important_moments.map((m) => `${m.time}s ${m.type}`).join("; ") || "none";
  return `VIDEO
${analysis.summary}
Category: ${analysis.content_category}. Aesthetic: ${analysis.aesthetic.join(", ")}. Mood: ${analysis.mood.join(", ")}.
Energy ${analysis.energy}, pacing ${analysis.pacing}. Dialogue: ${analysis.dialogue_present ? "yes" : "no"}. Key moments: ${moments}.

MUSIC BRIEF
${brief.text}

DIMENSIONS (score each 0–1, reason ≤ 12 words)
${defs}

CANDIDATES (${cands.length}; return exactly ${cands.length} objects, indexes 0–${cands.length - 1})
${list}

Return ONLY a JSON array with one object per candidate:
{ "index": number, "semantic": {"score": number, "reason": string}, "emotional": {...}, "aesthetic": {...}, "pacing": {...}, "cultural": {...}, "originality": {...} }`;
}

export function parseScores(
  text: string, count: number,
): { ok: true; scores: Record<ModelDimension, ComponentScore>[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "no JSON found" };
  }
  const arr = z.array(Item).safeParse(raw);
  if (!arr.success) return { ok: false, error: arr.error.message };
  const byIndex = new Map<number, Record<ModelDimension, ComponentScore>>();
  for (const { index, ...rest } of arr.data) byIndex.set(index, rest as Record<ModelDimension, ComponentScore>);
  const scores: Record<ModelDimension, ComponentScore>[] = [];
  for (let i = 0; i < count; i++) {
    const s = byIndex.get(i);
    if (!s) return { ok: false, error: `missing index ${i}` };
    scores.push(s);
  }
  return { ok: true, scores };
}

export async function modelScores(
  analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[],
  deps: { call?: ClaudeCall } = {},
): Promise<Record<ModelDimension, ComponentScore>[]> {
  const call = deps.call ?? callClaude;
  const user = buildScoringPrompt(analysis, brief, cands);
  const maxTokens = Math.min(16000, 500 + cands.length * TOKENS_PER_ITEM);
  const started = Date.now();
  const first = await call({ model: MODELS.scoring, system: SYSTEM, user, maxTokens, timeoutMs: LIMITS.modelTimeoutMs });
  const r1 = parseScores(first, cands.length);
  if (r1.ok) {
    logger.info("scoring", { ms: Date.now() - started, candidates: cands.length, chars: first.length });
    return r1.scores;
  }
  logger.warn("scoring.retry", { error: r1.error.slice(0, 300) });
  const retryUser = `${user}\n\nPREVIOUS OUTPUT WAS INVALID. Validation error:\n${r1.error.slice(0, 2000)}\nReturn the full corrected JSON array with every index.`;
  const second = await call({ model: MODELS.scoring, system: SYSTEM, user: retryUser, maxTokens, timeoutMs: LIMITS.modelTimeoutMs });
  const r2 = parseScores(second, cands.length);
  if (r2.ok) return r2.scores;
  throw new PipelineError("recommend", `scoring output invalid: ${r2.error.slice(0, 200)}`, second);
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
      originality: lower(fromModel[i]!.originality, overuseScore(c)),
    };
    return { ...c, component_scores, total_score: combine(component_scores) };
  });
  return scored.sort((a, b) => b.total_score - a.total_score);
}

/** The overuse rule caps originality: a saturated song cannot score high on originality. */
function lower(a: { score: number; reason: string }, b: { score: number; reason: string }) {
  return a.score <= b.score ? a : b;
}
```

- [ ] **Step 8: Run all scoring tests**

Run: `pnpm test -- tests/engine/scoring`
Expected: PASS, 11 tests.

- [ ] **Step 9: Commit**

```bash
pnpm typecheck && git add src/engine/scoring tests/engine/scoring
git commit -m "Add strict candidate scoring: batched model dimensions, dialogue and overuse rules, weights"
```

---

### Task 3.7: Diversify into 3 picks (rank 1 is always "Best fit")

**Files:**
- Create: `src/engine/diversify/diversify.ts`
- Test: `tests/engine/diversify/diversify.test.ts`

**Interfaces:**
- Consumes: `ScoredCandidate`, `Pick`, `DirectionTag`, `DIRECTION_LABEL`; `normalizeArtist`; `PipelineError`.
- Produces:
  ```ts
  export function primaryDirection(c: { directions: DirectionTag[] }): DirectionTag; // first membership
  export const RUNNER_UP_LABEL: Record<DirectionTag, string>; // safe: "Safe bet", current: "More current", unexpected: "Unexpected"
  export function diversify(scored: ScoredCandidate[]): Pick[]; // length 3, ranks 1–3
  ```

Ruling I9: overall rank and generation direction are different things. Rank 1 is the top total and is labeled "Best fit" whatever its direction. Ranks 2–3 are labeled by their primary direction (`RUNNER_UP_LABEL`, which equals the header's `DIRECTION_LABEL`: safe → "Safe bet"; rank 1 uses `BEST_FIT_LABEL`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/diversify/diversify.test.ts
import { describe, it, expect } from "vitest";
import { diversify } from "@/src/engine/diversify/diversify";
import type { DirectionTag } from "@/src/shared/types";
import { scored } from "../fixtures";

let n = 0;
const sc = (title: string, directions: DirectionTag[], total: number, artist = `Artist ${++n}`) =>
  scored({ title, canonical_title: title, artist, canonical_artist: artist, directions, deezer_id: String(++n), total_score: total });

describe("diversify", () => {
  it("rank 1 is top overall labeled Best fit; 2 and 3 come from other directions", () => {
    const out = diversify([
      sc("S1", ["safe"], 0.9), sc("S2", ["safe"], 0.85), sc("C1", ["current"], 0.8), sc("U1", ["unexpected"], 0.6), sc("C2", ["current"], 0.7),
    ]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "U1"]);
    expect(out.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(out.map((p) => p.direction_label)).toEqual(["Best fit", "More current", "Unexpected"]);
    expect(out[0]).toMatchObject({ start_seconds: 43, end_seconds: 58, aligned_to_moment: null });
  });
  it("a top candidate from the unexpected direction is still labeled Best fit", () => {
    const out = diversify([sc("U1", ["unexpected"], 0.95), sc("S1", ["safe"], 0.9), sc("C1", ["current"], 0.8)]);
    expect(out.map((p) => p.direction_label)).toEqual(["Best fit", "Safe bet", "More current"]);
  });
  it("a song proposed in two directions does not count as a different direction from rank 1", () => {
    const out = diversify([sc("S1", ["safe"], 0.9), sc("X", ["safe", "current"], 0.88), sc("C1", ["current"], 0.8), sc("U1", ["unexpected"], 0.5)]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "U1"]);
  });
  it("falls back to next best overall when a direction is empty", () => {
    const out = diversify([sc("S1", ["safe"], 0.9), sc("S2", ["safe"], 0.85), sc("C1", ["current"], 0.8)]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "S2"]);
    expect(out[2]!.direction_label).toBe("Safe bet");
  });
  it("prefers a different artist when a close alternative exists", () => {
    const out = diversify([
      sc("S1", ["safe"], 0.9, "Drake"), sc("C1", ["current"], 0.8, "Drake"), sc("C2", ["current"], 0.75, "SZA"), sc("U1", ["unexpected"], 0.5, "Khruangbin"),
    ]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C2", "U1"]);
  });
  it("keeps the repeated artist when the alternative is far worse", () => {
    const out = diversify([
      sc("S1", ["safe"], 0.9, "Drake"), sc("C1", ["current"], 0.8, "Drake"), sc("C2", ["current"], 0.5, "SZA"), sc("U1", ["unexpected"], 0.5, "Khruangbin"),
    ]);
    expect(out[1]!.title).toBe("C1");
  });
  it("throws with fewer than 3 candidates", () => {
    expect(() => diversify([sc("S1", ["safe"], 0.9), sc("S2", ["safe"], 0.8)])).toThrow(/fewer than 3/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/diversify/diversify.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/diversify/diversify.ts
import { DirectionTag, type Pick, type ScoredCandidate } from "@/src/shared/types";
import { PipelineError } from "@/src/shared/errors";
import { normalizeArtist } from "@/src/engine/catalog/normalize";

const ARTIST_TOLERANCE = 0.1;

export const RUNNER_UP_LABEL: Record<DirectionTag, string> = {
  safe: "Safe bet",
  current: "More current",
  unexpected: "Unexpected",
};

export function primaryDirection(c: { directions: DirectionTag[] }): DirectionTag {
  return c.directions[0] ?? "safe";
}

export function diversify(scored: ScoredCandidate[]): Pick[] {
  if (scored.length < 3) throw new PipelineError("recommend", `fewer than 3 verified candidates (${scored.length})`);
  const sorted = [...scored].sort((a, b) => b.total_score - a.total_score);
  const picks: ScoredCandidate[] = [];
  const usedIds = new Set<string>();
  const usedArtists = new Set<string>();
  const usedDirections = new Set<DirectionTag>();

  const take = (c: ScoredCandidate) => {
    picks.push(c);
    usedIds.add(c.deezer_id);
    usedArtists.add(normalizeArtist(c.canonical_artist));
    usedDirections.add(primaryDirection(c));
  };
  const preferNewArtist = (pool: ScoredCandidate[]): ScoredCandidate | undefined => {
    const first = pool[0];
    if (!first || !usedArtists.has(normalizeArtist(first.canonical_artist))) return first;
    const alt = pool.find(
      (c) => !usedArtists.has(normalizeArtist(c.canonical_artist)) && first.total_score - c.total_score <= ARTIST_TOLERANCE,
    );
    return alt ?? first;
  };

  take(sorted[0]!);
  while (picks.length < 3) {
    const available = sorted.filter((c) => !usedIds.has(c.deezer_id));
    // "Different direction" means none of the candidate's memberships is a direction already picked.
    const fresh = available.filter((c) => c.directions.every((d) => !usedDirections.has(d)));
    const choice = preferNewArtist(fresh.length ? fresh : available);
    if (!choice) break;
    take(choice);
  }
  if (picks.length < 3) throw new PipelineError("recommend", "could not assemble 3 distinct picks");

  return picks.map((c, i) => ({
    ...c,
    rank: (i + 1) as 1 | 2 | 3,
    direction_label: i === 0 ? "Best fit" : RUNNER_UP_LABEL[primaryDirection(c)],
    start_seconds: c.proposed_start,
    end_seconds: c.proposed_end,
    aligned_to_moment: null,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/diversify/diversify.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/diversify tests/engine/diversify
git commit -m "Add diversification: Best fit first, then distinct directions"
```

---

### Task 3.8: Section selection with honest anchor alignment

**Files:**
- Create: `src/engine/sections/selectSections.ts`
- Test: `tests/engine/sections/selectSections.test.ts`

**Interfaces:**
- Consumes: `Pick` (with `anchor_seconds`, `duration_seconds`), `VideoAnalysis`, `LIMITS.sectionMin/sectionMax`.
- Produces:
  ```ts
  export function fitWindow(start: number, end: number, anchor: number, duration: number): { start: number; end: number }; // length in [min,max], inside track, contains anchor
  export function alignToMoment(window: { start: number; end: number }, anchor: number, duration: number, analysis: VideoAnalysis): { start: number; end: number; aligned_to_moment: number } | null;
  export function selectSections(picks: Pick[], analysis: VideoAnalysis): Pick[];
  ```

Ruling C6. ASSUMPTION, written into the module: the creator starts the chosen section at video time 0. The song's defining moment is at `anchor_seconds` (the model's claim; unverified, see the footer copy in 3.11). To land the anchor on a video moment at time T, the section must start at `anchor − T`. We apply that ONLY when the result is feasible (`start ≥ 0`, `start + length ≤ duration`, anchor inside); otherwise we keep the window and record `aligned_to_moment = null` so no downstream copy claims alignment. No clamping to 0: clamping would put the hit at the wrong video time and then describe it as aligned. The "nudge rank 2 by 2 s" rule is removed (M1).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/sections/selectSections.test.ts
import { describe, it, expect } from "vitest";
import { fitWindow, alignToMoment, selectSections } from "@/src/engine/sections/selectSections";
import type { VideoAnalysis } from "@/src/shared/types";
import { analysis, pick } from "../fixtures";

const quiet: VideoAnalysis = { ...analysis, important_moments: [] };

describe("fitWindow", () => {
  it("shortens a long window by moving the end only", () => {
    expect(fitWindow(40, 70, 45, 200)).toEqual({ start: 40, end: 60 });
  });
  it("lengthens a short window by moving the end only", () => {
    expect(fitWindow(50, 54, 51, 200)).toEqual({ start: 50, end: 62 });
  });
  it("pulls the window back when it runs past the track end", () => {
    expect(fitWindow(85, 110, 90, 100)).toEqual({ start: 80, end: 100 });
  });
  it("moves the window to contain an anchor that fell outside it", () => {
    expect(fitWindow(20, 35, 50, 200)).toEqual({ start: 48, end: 63 });
  });
});

describe("alignToMoment", () => {
  it("shifts the window so the anchor lands on the reveal", () => {
    // reveal at 7.8 s, anchor at 50 s, 15 s window → start 42.2
    expect(alignToMoment({ start: 45, end: 60 }, 50, 200, analysis)).toEqual({ start: 42.2, end: 57.2, aligned_to_moment: 7.8 });
  });
  it("does NOT align (and does not clamp) when the anchor is earlier than the reveal", () => {
    // anchor 5 s, reveal 10 s → start would be −5 → no alignment claimed
    const late: VideoAnalysis = { ...analysis, important_moments: [{ time: 10, type: "main_visual_reveal" }] };
    expect(alignToMoment({ start: 0, end: 15 }, 5, 200, late)).toBeNull();
  });
  it("returns null when there is no key moment", () => {
    expect(alignToMoment({ start: 45, end: 60 }, 50, 200, quiet)).toBeNull();
  });
  it("returns null when the aligned window would run past the track end", () => {
    expect(alignToMoment({ start: 185, end: 200 }, 199.5, 200, { ...analysis, important_moments: [{ time: 2, type: "climax" }] })).toBeNull();
  });
});

describe("selectSections", () => {
  it("fits every window, aligns every pick that can be aligned, and never nudges lengths", () => {
    const out = selectSections(
      [
        pick({ rank: 1, proposed_start: 45, proposed_end: 60, anchor_seconds: 50, start_seconds: 45, end_seconds: 60 }),
        pick({ rank: 2, deezer_id: "2", proposed_start: 0, proposed_end: 15, anchor_seconds: 3, start_seconds: 0, end_seconds: 15 }),
        pick({ rank: 3, deezer_id: "3", proposed_start: 20, proposed_end: 60, anchor_seconds: 22, start_seconds: 20, end_seconds: 60 }),
      ],
      analysis,
    );
    // rank 1: anchor 50 − reveal 7.8 → 42.2
    expect(out[0]).toMatchObject({ start_seconds: 42.2, end_seconds: 57.2, aligned_to_moment: 7.8 });
    // rank 2: anchor 3 is before the reveal → no alignment, window unchanged
    expect(out[1]).toMatchObject({ start_seconds: 0, end_seconds: 15, aligned_to_moment: null });
    // rank 3: window first fitted to 20 s (20–40), then aligned: 22 − 7.8 = 14.2
    expect(out[2]).toMatchObject({ start_seconds: 14.2, end_seconds: 34.2, aligned_to_moment: 7.8 });
    expect(out.map((p) => p.end_seconds - p.start_seconds)).toEqual([15, 15, 20]);
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
// anchor_seconds is the generator's claim of where the song's defining moment is. A creator starts
// the chosen section at video time 0. To land the anchor on a video moment at time T the section
// must start at (anchor − T). We only claim alignment when that is feasible; otherwise the window is
// kept as proposed and aligned_to_moment is null. We never clamp to 0 and call it aligned.
import type { Pick, VideoAnalysis } from "@/src/shared/types";
import { LIMITS } from "@/src/shared/config";

const KEY_MOMENT_TYPES = new Set(["main_visual_reveal", "climax", "transition"]);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Length in [sectionMin, sectionMax] (move end only), inside the track, containing the anchor. */
export function fitWindow(start: number, end: number, anchor: number, duration: number): { start: number; end: number } {
  let s = Math.max(0, start);
  let len = Math.min(LIMITS.sectionMax, Math.max(LIMITS.sectionMin, end - s));
  let e = s + len;
  if (anchor < s || anchor > e) {
    s = Math.max(0, anchor - 2);
    e = s + len;
  }
  if (duration > 0 && e > duration) {
    e = duration;
    s = Math.max(0, e - len);
  }
  return { start: round1(s), end: round1(e) };
}

export function alignToMoment(
  window: { start: number; end: number }, anchor: number, duration: number, analysis: VideoAnalysis,
): { start: number; end: number; aligned_to_moment: number } | null {
  const moment = [...analysis.important_moments]
    .filter((m) => KEY_MOMENT_TYPES.has(m.type))
    .sort((a, b) => a.time - b.time)[0];
  if (!moment) return null;
  const len = window.end - window.start;
  const start = anchor - moment.time;
  if (start < 0) return null;
  if (duration > 0 && start + len > duration) return null;
  if (anchor < start || anchor > start + len) return null;
  return { start: round1(start), end: round1(start + len), aligned_to_moment: moment.time };
}

export function selectSections(picks: Pick[], analysis: VideoAnalysis): Pick[] {
  return picks.map((p) => {
    const fitted = fitWindow(p.start_seconds, p.end_seconds, p.anchor_seconds, p.duration_seconds);
    const aligned = alignToMoment(fitted, p.anchor_seconds, p.duration_seconds, analysis);
    return aligned
      ? { ...p, start_seconds: aligned.start, end_seconds: aligned.end, aligned_to_moment: aligned.aligned_to_moment }
      : { ...p, start_seconds: fitted.start, end_seconds: fitted.end, aligned_to_moment: null };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/sections/selectSections.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/sections tests/engine/sections
git commit -m "Add section selection with feasible-only anchor alignment"
```

---

### Task 3.9: Explanations in the Songfit voice (strict, alignment-aware)

**Files:**
- Create: `src/engine/explain/explainPicks.ts`
- Test: `tests/engine/explain/explainPicks.test.ts`

**Interfaces:**
- Consumes: `Pick`, `FinalRecommendation`, `VideoAnalysis`, `MusicBrief`; `callClaude`; `extractJson`; `findItunesPreview` (Task 3.4); `DIMENSIONS`; `MODELS.explain`.
- Produces:
  ```ts
  export const PROMPT_VERSION = "explain-v2";
  export function spotifySearchUrl(title: string, artist: string): string;
  export function parseExplanations(text: string, ranks: number[]): { ok: true; byRank: Map<number, string> } | { ok: false; error: string };
  export async function explainPicks(picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief, deps?: { call?: ClaudeCall; itunes?: typeof findItunesPreview }): Promise<FinalRecommendation[]>;
  ```

Rulings C1 (all three required, one retry, then fail — no fit_reason fallback), C6/I9 (mention alignment only when `aligned_to_moment` is non-null; never claim trend status or platform availability), I5 (iTunes only for a missing preview; failure never blocks).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/explain/explainPicks.test.ts
import { describe, it, expect, vi } from "vitest";
import { explainPicks, spotifySearchUrl, buildExplainPrompt } from "@/src/engine/explain/explainPicks";
import { analysis, brief, pick } from "../fixtures";

const three = () => [
  pick({ rank: 1, title: "Song 1", aligned_to_moment: 7.8 }),
  pick({ rank: 2, deezer_id: "2", title: "Song 2", direction_label: "More current" }),
  pick({ rank: 3, deezer_id: "3", title: "Song 3", direction_label: "Unexpected", preview_url: "https://d.mp3" }),
];
const ok = JSON.stringify([{ rank: 1, explanation: "One." }, { rank: 2, explanation: "Two." }, { rank: 3, explanation: "Three." }]);

describe("explainPicks", () => {
  it("attaches explanations and spotify url; asks iTunes only for picks missing a preview", async () => {
    const call = vi.fn(async () => ok);
    const itunes = vi.fn(async (title: string) => (title === "Song 2" ? { itunesId: "99", previewUrl: "https://i.m4a" } : null));
    const out = await explainPicks(three(), analysis, brief, { call, itunes });
    expect(out.map((r) => r.explanation)).toEqual(["One.", "Two.", "Three."]);
    expect(out[0]!.spotify_url).toBe(spotifySearchUrl("Song 1", "The Weeknd"));
    expect(out[1]).toMatchObject({ preview_url: "https://i.m4a", itunes_id: "99" });
    expect(out[2]).toMatchObject({ preview_url: "https://d.mp3", itunes_id: null });
    expect(itunes.mock.calls.map((c) => c[0])).toEqual(["Song 1", "Song 2"]); // Song 3 already had a preview
  });
  it("retries once when a rank is missing, then throws", async () => {
    const call = vi.fn(async () => JSON.stringify([{ rank: 1, explanation: "One." }]));
    await expect(explainPicks(three(), analysis, brief, { call, itunes: async () => null })).rejects.toThrow(/explanation output invalid/);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("tells the model about alignment only where it happened", () => {
    const p = buildExplainPrompt(three(), analysis, brief);
    expect(p).toMatch(/#1 .*aligned: the song's moment lands at 7\.8s/);
    expect(p).toMatch(/#2 .*aligned: no/);
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
import { MODELS, LIMITS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { findItunesPreview } from "@/src/engine/catalog/itunes";

export const PROMPT_VERSION = "explain-v2";

const SYSTEM = `You write the two-sentence reasons under Songfit's song picks. Voice: a sharp friend who edits
video. Second person. Two sentences, each under 20 words. No hype, no emojis, no exclamation marks,
no words like "perfect", "vibe", "elevate". Never mention scores, models, AI, or how the pick was made.
Never claim a song is trending, viral, popular right now, or available on any platform.
Each reason names something specific from the video and says what the song section does for it.
Mention the song's moment landing on a video moment ONLY for picks marked "aligned: the song's moment lands at …".`;

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

const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function buildExplainPrompt(picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief): string {
  const list = picks
    .map((p) => `#${p.rank} (${p.direction_label}): "${p.canonical_title}" — ${p.canonical_artist}, use ${fmt(p.start_seconds)}–${fmt(p.end_seconds)}; aligned: ${p.aligned_to_moment === null ? "no" : `the song's moment lands at ${p.aligned_to_moment}s of the video`}.
   Section: ${p.section_reason}. Why proposed: ${p.fit_reason}. Strongest reasons: ${topReasons(p) || "n/a"}.`)
    .join("\n");
  return `VIDEO: ${analysis.summary}
Key moments: ${analysis.important_moments.map((m) => `${m.time}s ${m.type}`).join("; ") || "none"}
BRIEF: ${brief.text}

PICKS
${list}

Return ONLY a JSON array with all ${picks.length} ranks: [{ "rank": 1, "explanation": "..." }, ...]`;
}

export function spotifySearchUrl(title: string, artist: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`)}`;
}

export function parseExplanations(text: string, ranks: number[]): { ok: true; byRank: Map<number, string> } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "no JSON found" };
  }
  const arr = z.array(Item).safeParse(raw);
  if (!arr.success) return { ok: false, error: arr.error.message };
  const byRank = new Map(arr.data.map((i) => [i.rank, i.explanation.trim()]));
  for (const r of ranks) if (!byRank.get(r)) return { ok: false, error: `missing rank ${r}` };
  return { ok: true, byRank };
}

export async function explainPicks(
  picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief,
  deps: { call?: ClaudeCall; itunes?: typeof findItunesPreview } = {},
): Promise<FinalRecommendation[]> {
  const call = deps.call ?? callClaude;
  const itunes = deps.itunes ?? findItunesPreview;
  const ranks = picks.map((p) => p.rank);
  const user = buildExplainPrompt(picks, analysis, brief);

  const previewsP = Promise.all(picks.map((p) => (p.preview_url ? Promise.resolve(null) : itunes(p.canonical_title, p.canonical_artist))));

  const started = Date.now();
  const first = await call({ model: MODELS.explain, system: SYSTEM, user, maxTokens: 1500, timeoutMs: LIMITS.modelTimeoutMs });
  let parsed = parseExplanations(first, ranks);
  if (!parsed.ok) {
    logger.warn("explain.retry", { error: parsed.error.slice(0, 300) });
    const second = await call({
      model: MODELS.explain, system: SYSTEM,
      user: `${user}\n\nPREVIOUS OUTPUT WAS INVALID. Validation error:\n${parsed.error.slice(0, 1000)}\nReturn the full corrected JSON array.`,
      maxTokens: 1500, timeoutMs: LIMITS.modelTimeoutMs,
    });
    parsed = parseExplanations(second, ranks);
    if (!parsed.ok) throw new PipelineError("recommend", `explanation output invalid: ${parsed.error.slice(0, 200)}`, second);
  }
  logger.info("explain", { ms: Date.now() - started });

  const previews = await previewsP;
  const byRank = parsed.byRank;
  return picks.map((p, i) => {
    const it = previews[i] ?? null;
    return {
      ...p,
      explanation: byRank.get(p.rank)!,
      spotify_url: spotifySearchUrl(p.canonical_title, p.canonical_artist),
      itunes_id: it?.itunesId ?? null,
      preview_url: p.preview_url ?? it?.previewUrl ?? null,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/engine/explain/explainPicks.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/explain tests/engine/explain
git commit -m "Add strict Songfit-voice explanations with alignment-aware prompting"
```

---
### Task 3.10: Orchestrator `recommendSubmission` (plugs into the Phase 2 runner)

**Files:**
- Create: `src/engine/recommend.ts`
- Modify: `src/pipeline/run.ts` (ONE line: the default `recommend` dep)
- Modify: `src/db/queries/submissions.ts` (`setSubmissionStatus` sets `recommended_at` only when null)
- Test: `tests/engine/recommend.test.ts`

**Interfaces:**
- Consumes: Tasks 3.2–3.9; from Phase 0: `getSubmission(id)`, `getAnalysis(submissionId) → { analysis, brief, row } | null`, `setSubmissionStatus(id, status, error?)`, `replaceCandidates(submissionId, rows: CandidateInsert[]) → CandidateRow[]` (rows carry `id`, `deezer_id`), `replaceRecommendations(submissionId, rows: RecommendationInsert[])`, `logEvent`, `PipelineError`; from Phase 2: `runSubmission(id, deps)` whose deps include `recommend: (submissionId: string) => Promise<void>` (Phase 2 ships a stub that throws `PipelineError("recommend", "not implemented")`).
- Produces:
  ```ts
  export type RecommendDeps = { getSubmission; getAnalysis; generate; verify; score; diversify; sections; explain; replaceCandidates; replaceRecommendations; setStatus; logEvent };
  export function toCandidateInsert(submissionId: string, c: GeneratedCandidate | ScoredCandidate, verified: boolean, promptVersion: string): CandidateInsert;
  export async function recommendSubmission(submissionId: string, deps?: RecommendDeps): Promise<void>;
  ```

Rulings C3 (one runner; this task does not rewrite `src/pipeline/run.ts`), I4 (regeneration merges with the first attempt by `deezer_id` and excludes seen keys), I7 (`recommendations_ready` carries `creatorId`), I8 (structured provenance persisted: canonical names, anchor, directions, both reasons, `source`, explain prompt version).

- [ ] **Step 1: Make `setSubmissionStatus` preserve the first `recommended_at`**

In `src/db/queries/submissions.ts` (Phase 0), change the `ready` branch so a retry never overwrites the first readiness time (I7):

```ts
export async function setSubmissionStatus(id: string, status: SubmissionStatus, error?: string | null): Promise<void> {
  const db = createServiceClient();
  const patch: Database["public"]["Tables"]["submissions"]["Update"] = { status, error: error ?? null };
  const { error: e1 } = await db.from("submissions").update(patch).eq("id", id);
  if (e1) throw e1;
  if (status === "ready") {
    // Only stamp recommended_at the first time; retries keep the original timestamp.
    const { error: e2 } = await db.from("submissions")
      .update({ recommended_at: new Date().toISOString() })
      .eq("id", id)
      .is("recommended_at", null);
    if (e2) throw e2;
  }
}
```

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 2: Write the failing orchestrator tests**

```ts
// tests/engine/recommend.test.ts
import { describe, it, expect, vi } from "vitest";
import { recommendSubmission, type RecommendDeps } from "@/src/engine/recommend";
import type { GeneratedCandidate, VerifiedCandidate, FinalRecommendation } from "@/src/shared/types";
import { analysis, brief, gen, ver, scored, pick } from "./fixtures";

const row = { id: "sub-1", creator_id: "cre-1", status: "recommending" } as never;
const finalsFrom = (vs: VerifiedCandidate[]): FinalRecommendation[] =>
  vs.slice(0, 3).map((v, i) => ({ ...pick({ ...v, rank: (i + 1) as 1 | 2 | 3 }), explanation: "e", spotify_url: "s", itunes_id: null }));

function makeDeps(over: Partial<RecommendDeps> = {}): RecommendDeps & { calls: string[] } {
  const calls: string[] = [];
  const deps: RecommendDeps = {
    getSubmission: vi.fn(async () => row),
    getAnalysis: vi.fn(async () => ({ analysis, brief, row: {} as never })),
    generate: vi.fn(async () => { calls.push("generate"); return []; }),
    verify: vi.fn(async () => { calls.push("verify"); return { verified: [], unverified: [] }; }),
    score: vi.fn(async (_a, _b, vs: VerifiedCandidate[]) => { calls.push("score"); return vs.map((v) => scored(v)); }),
    diversify: vi.fn((s) => { calls.push("diversify"); return s.slice(0, 3).map((c, i) => pick({ ...c, rank: (i + 1) as 1 | 2 | 3 })); }),
    sections: vi.fn((p) => { calls.push("sections"); return p; }),
    explain: vi.fn(async (p) => { calls.push("explain"); return p.map((x) => ({ ...x, explanation: "e", spotify_url: "s", itunes_id: null })); }),
    replaceCandidates: vi.fn(async (_id: string, rows: { deezer_id: string | null }[]) => {
      calls.push("replaceCandidates");
      return rows.map((r, i) => ({ id: `cand-${i}`, deezer_id: r.deezer_id })) as never;
    }),
    replaceRecommendations: vi.fn(async () => { calls.push("replaceRecommendations"); }),
    setStatus: vi.fn(async () => { calls.push("setStatus"); }),
    logEvent: vi.fn(async () => {}),
    ...over,
  };
  return Object.assign(deps, { calls });
}

describe("recommendSubmission", () => {
  it("runs the stages in order, persists unverified rows, links recommendations to candidate ids, logs with creatorId", async () => {
    const generated = [gen({ title: "V1" }), gen({ title: "V2" }), gen({ title: "V3" }), gen({ title: "Missing" })];
    const verified = generated.slice(0, 3).map((c, i) => ver({ ...c, deezer_id: String(i + 1) }));
    const deps = makeDeps({
      generate: vi.fn(async () => generated),
      verify: vi.fn(async () => ({ verified, unverified: [generated[3]!] })),
    });
    await recommendSubmission("sub-1", deps);
    expect(deps.calls.filter((c) => c !== "generate" && c !== "verify"))
      .toEqual(["score", "replaceCandidates", "diversify", "sections", "explain", "replaceRecommendations", "setStatus"]);
    const rows = (deps.replaceCandidates as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { verified: boolean; directions: string[]; anchor_seconds: number; source: string }[];
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => !r.verified)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "model", directions: ["safe"], anchor_seconds: 45 });
    expect(deps.setStatus).toHaveBeenCalledWith("sub-1", "ready");
    expect(deps.logEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "recommendations_ready", creatorId: "cre-1", submissionId: "sub-1" }));
    const recRows = (deps.replaceRecommendations as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { candidate_id: string | null; explain_prompt_version: string }[];
    expect(recRows.map((r) => r.candidate_id)).toEqual(["cand-0", "cand-1", "cand-2"]);
    expect(recRows[0]!.explain_prompt_version).toBe("explain-v2");
  });

  it("regenerates once with exclusions and merges by deezer id", async () => {
    const first = [gen({ title: "A" }), gen({ title: "B" }), gen({ title: "Gone" })];
    const second = [gen({ title: "A - Remastered" }), gen({ title: "C" })]; // A again (same recording), plus C
    const generate = vi.fn(async (_b, _a, opts?: { exclude?: string[] }) => (opts?.exclude ? second : first));
    const verify = vi.fn(async (cands: GeneratedCandidate[]) => ({
      verified: cands.filter((c) => c.title !== "Gone").map((c) => ver({ ...c, deezer_id: c.title.startsWith("A") ? "10" : c.title === "B" ? "11" : "12" })),
      unverified: cands.filter((c) => c.title === "Gone"),
    }));
    const deps = makeDeps({ generate, verify });
    await recommendSubmission("sub-1", deps);
    expect(generate).toHaveBeenCalledTimes(2);
    const opts = (generate.mock.calls[1] as unknown[])[2] as { exclude: string[]; note: string };
    expect(opts.exclude).toEqual(expect.arrayContaining(["a|the weeknd", "b|the weeknd", "gone|the weeknd"]));
    expect(opts.note).toMatch(/could not be found/);
    const scoredArg = (deps.score as ReturnType<typeof vi.fn>).mock.calls[0]![2] as VerifiedCandidate[];
    expect(scoredArg.map((v) => v.deezer_id).sort()).toEqual(["10", "11", "12"]);
    const rows = (deps.replaceCandidates as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { prompt_version: string }[];
    expect(rows.some((r) => r.prompt_version.endsWith("#2"))).toBe(true);
  });

  it("fails when still fewer than 3 distinct recordings after regeneration", async () => {
    const deps = makeDeps({
      generate: vi.fn(async () => [gen({ title: "X" })]),
      verify: vi.fn(async (c: GeneratedCandidate[]) => ({ verified: c.map((x) => ver({ ...x, deezer_id: "1" })), unverified: [] })),
    });
    await expect(recommendSubmission("sub-1", deps)).rejects.toThrow(/fewer than 3/);
    expect(deps.replaceCandidates).toHaveBeenCalled(); // what we saw is still persisted for the inspector
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- tests/engine/recommend.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write the orchestrator**

```ts
// src/engine/recommend.ts
import type {
  FinalRecommendation, GeneratedCandidate, MusicBrief, Pick, ScoredCandidate, SubmissionStatus,
  VerifiedCandidate, VideoAnalysis,
} from "@/src/shared/types";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { generateCandidates, PROMPT_VERSION as CANDIDATES_VERSION, type GenerateOpts } from "@/src/engine/candidates/generateCandidates";
import { normalizeKey } from "@/src/engine/catalog/normalize";
import { verifyCandidates } from "@/src/engine/catalog/verifyCandidates";
import { scoreCandidates } from "@/src/engine/scoring/scoreCandidates";
import { PROMPT_VERSION as SCORING_VERSION } from "@/src/engine/scoring/modelScores";
import { diversify } from "@/src/engine/diversify/diversify";
import { selectSections } from "@/src/engine/sections/selectSections";
import { explainPicks, PROMPT_VERSION as EXPLAIN_VERSION } from "@/src/engine/explain/explainPicks";
import { getAnalysis } from "@/src/db/queries/analyses";
import { getSubmission, setSubmissionStatus, type SubmissionRow } from "@/src/db/queries/submissions";
import { replaceCandidates, type CandidateInsert, type CandidateRow } from "@/src/db/queries/candidates";
import { replaceRecommendations, type RecommendationInsert } from "@/src/db/queries/recommendations";
import { logEvent } from "@/src/feedback/events";

export type RecommendDeps = {
  getSubmission: (id: string) => Promise<SubmissionRow | null>;
  getAnalysis: (submissionId: string) => Promise<{ analysis: VideoAnalysis; brief: MusicBrief; row: unknown } | null>;
  generate: (brief: MusicBrief, analysis: VideoAnalysis, opts?: GenerateOpts) => Promise<GeneratedCandidate[]>;
  verify: (cands: GeneratedCandidate[]) => Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }>;
  score: (analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[]) => Promise<ScoredCandidate[]>;
  diversify: (scored: ScoredCandidate[]) => Pick[];
  sections: (picks: Pick[], analysis: VideoAnalysis) => Pick[];
  explain: (picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief) => Promise<FinalRecommendation[]>;
  replaceCandidates: (submissionId: string, rows: CandidateInsert[]) => Promise<CandidateRow[]>;
  replaceRecommendations: (submissionId: string, rows: RecommendationInsert[]) => Promise<void>;
  setStatus: (id: string, status: SubmissionStatus, error?: string | null) => Promise<void>;
  logEvent: typeof logEvent;
};

const defaultDeps: RecommendDeps = {
  getSubmission, getAnalysis,
  generate: generateCandidates, verify: verifyCandidates, score: scoreCandidates,
  diversify, sections: selectSections, explain: explainPicks,
  replaceCandidates, replaceRecommendations, setStatus: setSubmissionStatus, logEvent,
};

const RETRY_NOTE = "Several previous suggestions could not be found on Deezer as the original recording; propose different, well-known songs by the original artists.";

export function toCandidateInsert(
  submissionId: string, c: GeneratedCandidate | ScoredCandidate, verified: boolean, promptVersion: string,
): CandidateInsert {
  const s = c as Partial<ScoredCandidate>;
  return {
    submission_id: submissionId,
    title: c.title,
    artist: c.artist,
    canonical_title: s.canonical_title ?? null,
    canonical_artist: s.canonical_artist ?? null,
    deezer_id: s.deezer_id ?? null,
    itunes_id: null,
    duration_seconds: s.duration_seconds ?? null,
    verified,
    proposed_start: c.proposed_start,
    proposed_end: c.proposed_end,
    anchor_seconds: c.anchor_seconds,
    section_is_vocal: c.section_is_vocal,
    directions: c.directions,
    section_reason: c.section_reason,
    fit_reason: c.fit_reason,
    source: "model",
    song_id: null,
    segment_id: null,
    component_scores: s.component_scores ?? null,
    total_score: s.total_score ?? null,
    prompt_version: promptVersion,
  };
}

function toRecommendationInsert(submissionId: string, candidateId: string | null, r: FinalRecommendation): RecommendationInsert {
  return {
    submission_id: submissionId,
    candidate_id: candidateId,
    rank: r.rank,
    direction_label: r.direction_label,
    title: r.canonical_title,
    artist: r.canonical_artist,
    start_seconds: r.start_seconds,
    end_seconds: r.end_seconds,
    aligned_to_moment: r.aligned_to_moment,
    explanation: r.explanation,
    explain_prompt_version: EXPLAIN_VERSION,
    spotify_url: r.spotify_url,
    deezer_url: r.deezer_url || null,
    artwork_url: r.artwork_url,
    preview_url: r.preview_url,
    selected: false,
    rejected: false,
  };
}

const distinctRecordings = (vs: VerifiedCandidate[]) => new Set(vs.map((v) => v.deezer_id)).size;

export async function recommendSubmission(submissionId: string, deps: RecommendDeps = defaultDeps): Promise<void> {
  const started = Date.now();
  const sub = await deps.getSubmission(submissionId);
  if (!sub) throw new PipelineError("recommend", "submission not found");
  const stored = await deps.getAnalysis(submissionId);
  if (!stored) throw new PipelineError("recommend", "no analysis stored for submission");
  const { analysis, brief } = stored;

  // Attempt 1
  const gen1 = await deps.generate(brief, analysis);
  const v1 = await deps.verify(gen1);
  let verified = v1.verified;
  let unverified = v1.unverified;
  const versionOf = new Map<string, string>(gen1.map((c) => [normalizeKey(c.title, c.artist), CANDIDATES_VERSION]));

  // Attempt 2 (I4): keep what we have, exclude everything seen, merge by recording id.
  if (distinctRecordings(verified) < 3) {
    const exclude = gen1.map((c) => normalizeKey(c.title, c.artist));
    logger.warn("recommend.regenerate", { submissionId, verified: distinctRecordings(verified) });
    const gen2 = await deps.generate(brief, analysis, { note: RETRY_NOTE, exclude });
    for (const c of gen2) versionOf.set(normalizeKey(c.title, c.artist), `${CANDIDATES_VERSION}#2`);
    const v2 = await deps.verify(gen2);
    const seen = new Set(verified.map((v) => v.deezer_id));
    for (const v of v2.verified) if (!seen.has(v.deezer_id)) { verified.push(v); seen.add(v.deezer_id); }
    unverified = [...unverified, ...v2.unverified];
  }

  const scored = distinctRecordings(verified) >= 3 ? await deps.score(analysis, brief, verified) : [];
  const rows: CandidateInsert[] = [
    ...scored.map((c) => toCandidateInsert(submissionId, c, true, `${versionOf.get(normalizeKey(c.title, c.artist)) ?? CANDIDATES_VERSION}+${SCORING_VERSION}`)),
    ...(scored.length ? [] : verified).map((c) => toCandidateInsert(submissionId, c, true, versionOf.get(normalizeKey(c.title, c.artist)) ?? CANDIDATES_VERSION)),
    ...unverified.map((c) => toCandidateInsert(submissionId, c, false, versionOf.get(normalizeKey(c.title, c.artist)) ?? CANDIDATES_VERSION)),
  ];
  const inserted = await deps.replaceCandidates(submissionId, rows); // persisted even when we fail next, for the inspector
  if (distinctRecordings(verified) < 3) {
    throw new PipelineError("recommend", `fewer than 3 verified candidates (${distinctRecordings(verified)})`);
  }
  const idByDeezer = new Map(inserted.filter((r) => r.deezer_id).map((r) => [r.deezer_id as string, r.id]));

  const picks = deps.sections(deps.diversify(scored), analysis);
  const finals = await deps.explain(picks, analysis, brief);

  await deps.replaceRecommendations(
    submissionId,
    finals.map((r) => toRecommendationInsert(submissionId, idByDeezer.get(r.deezer_id) ?? null, r)),
  );
  await deps.setStatus(submissionId, "ready");
  await deps.logEvent({
    name: "recommendations_ready", creatorId: sub.creator_id, submissionId,
    metadata: { candidates: rows.length, verified: distinctRecordings(verified), ms: Date.now() - started },
  });
}
```

- [ ] **Step 5: Plug into the runner (one line)**

In `src/pipeline/run.ts` (Phase 2), replace the stub import in the default deps:

```ts
// before (Phase 2 stub)
// recommend: async (id) => { throw new PipelineError("recommend", "not implemented"); },
// after
import { recommendSubmission } from "@/src/engine/recommend";
// … in defaultDeps:
recommend: recommendSubmission,
```

Nothing else in `run.ts` changes: status handling, the atomic claim, the time budget and `pipeline_failed` logging all stay as Phase 2 wrote them (ruling C3).

- [ ] **Step 6: Run tests**

Run: `pnpm test -- tests/engine tests/pipeline`
Expected: PASS, all engine tests (recommend: 3) and the Phase 2 pipeline tests still green.

- [ ] **Step 7: Commit**

```bash
pnpm typecheck && git add src/engine/recommend.ts src/pipeline/run.ts src/db/queries/submissions.ts tests/engine/recommend.test.ts
git commit -m "Add recommendation orchestrator with merged regeneration and plug it into the runner"
```

---

### Task 3.11: Results page and recommendation cards (`RecommendationView` only)

**Files:**
- Create: `src/shared/format.ts`, `src/shared/views.ts`, `components/RecommendationCard.tsx`, `components/ResultsView.tsx`
- Modify: `app/api/submissions/[id]/route.ts`, `app/results/[id]/page.tsx`
- Modify: `src/db/queries/submissions.ts` (add `markViewed`)
- Test: `tests/shared/format.test.ts`, `tests/shared/views.test.ts`

**Interfaces:**
- Consumes: `listRecommendations` (Phase 0), `getSubmission`, `getCreator` (Phase 1), `logEvent`, `<WaitingState submissionId>` (Phase 1), `RecommendationView` (header).
- Produces:
  ```ts
  export function formatTime(seconds: number): string;                                  // "0:43"
  export function toRecommendationView(row: RecommendationRow): RecommendationView;      // the ONLY mapper to the browser shape
  // GET /api/submissions/[id] → { status: SubmissionStatus; recommendations: RecommendationView[] }
  // <RecommendationCard rec chosen collapsed onSelect onReject />
  // <ResultsView submissionId recommendations />   (Phase 4 wires real handlers; here local state)
  ```

Rulings C5 (one DTO, no scores/reasons/directions to the browser), I10 (`selected`/`rejected` come from the server so refresh keeps state), C6 (footer copy).

- [ ] **Step 1: Write the failing tests**

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

```ts
// tests/shared/views.test.ts
import { describe, it, expect } from "vitest";
import { toRecommendationView } from "@/src/shared/views";
import { RecommendationView } from "@/src/shared/types";

describe("toRecommendationView", () => {
  it("maps a row to the browser shape and nothing more", () => {
    const row = {
      id: "r1", submission_id: "s1", candidate_id: "c1", rank: 1, direction_label: "Best fit", title: "T", artist: "A",
      start_seconds: "43", end_seconds: "58", aligned_to_moment: 7.8, explanation: "e", explain_prompt_version: "explain-v2",
      spotify_url: "https://open.spotify.com/search/T%20A", deezer_url: "d", artwork_url: null, preview_url: null,
      selected: false, rejected: true, created_at: "2026-10-07T00:00:00Z",
    } as never;
    const v = toRecommendationView(row);
    expect(RecommendationView.parse(v)).toEqual(v);
    expect(v).toMatchObject({ rank: 1, start_seconds: 43, end_seconds: 58, rejected: true, selected: false });
    expect(Object.keys(v).sort()).toEqual(Object.keys(RecommendationView.shape).sort());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/shared/format.test.ts tests/shared/views.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `formatTime` and the view mapper**

```ts
// src/shared/format.ts
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
```

```ts
// src/shared/views.ts
import { RecommendationView } from "@/src/shared/types";
import type { RecommendationRow } from "@/src/db/queries/recommendations";

/** Everything the browser is allowed to see about a recommendation. Validated so a new column never leaks by accident. */
export function toRecommendationView(r: RecommendationRow): RecommendationView {
  return RecommendationView.parse({
    rank: r.rank,
    direction_label: r.direction_label,
    title: r.title,
    artist: r.artist,
    start_seconds: Number(r.start_seconds),
    end_seconds: Number(r.end_seconds),
    explanation: r.explanation,
    artwork_url: r.artwork_url,
    preview_url: r.preview_url,
    spotify_url: r.spotify_url,
    selected: r.selected,
    rejected: r.rejected,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/shared/format.test.ts tests/shared/views.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Return recommendations from the status route**

```ts
// app/api/submissions/[id]/route.ts
import { NextResponse } from "next/server";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { toRecommendationView } from "@/src/shared/views";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sub = await getSubmission(id);
  if (!sub || sub.creator_id !== creator.id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const recommendations = sub.status === "ready" ? (await listRecommendations(id)).map(toRecommendationView) : [];
  return NextResponse.json({ status: sub.status, recommendations });
}
```

- [ ] **Step 6: Add `markViewed` and render the results page**

```ts
// add to src/db/queries/submissions.ts
/** Sets viewed_at once; returns true the first time. */
export async function markViewed(id: string): Promise<boolean> {
  const res = await createServiceClient().from("submissions")
    .update({ viewed_at: new Date().toISOString() }).eq("id", id).is("viewed_at", null).select("id");
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
import { toRecommendationView } from "@/src/shared/views";
import { logEvent } from "@/src/feedback/events";
import { WaitingState } from "@/components/WaitingState";
import { ResultsView } from "@/components/ResultsView";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const creator = await getCreator();
  if (!creator) redirect(`/?next=/results/${id}`);
  const sub = await getSubmission(id);
  if (!sub || sub.creator_id !== creator.id) notFound();

  if (sub.status !== "ready") return <WaitingState submissionId={id} status={sub.status} />;

  if (await markViewed(id)) {
    await logEvent({ name: "recommendations_viewed", creatorId: creator.id, submissionId: id });
  }
  const recs = (await listRecommendations(id)).map(toRecommendationView);
  return <ResultsView submissionId={id} recommendations={recs} />;
}
```

`WaitingState` gains an optional `status` prop here so a `failed` submission can render the honest failure state (ruling I10); Phase 4 Task 4.1 wires the copy. For this task pass it through; `WaitingState` may ignore it.

```tsx
// components/ResultsView.tsx
"use client";
import { useState } from "react";
import { RecommendationCard } from "@/components/RecommendationCard";
import type { RecommendationView } from "@/src/shared/types";

export function ResultsView({ submissionId, recommendations }: { submissionId: string; recommendations: RecommendationView[] }) {
  // Phase 4 replaces local state with the feedback API; the server-provided selected/rejected flags seed it.
  const [selected, setSelected] = useState<number | null>(recommendations.find((r) => r.selected)?.rank ?? null);
  const [rejected, setRejected] = useState<Set<number>>(new Set(recommendations.filter((r) => r.rejected).map((r) => r.rank)));
  void submissionId;

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your Songfit</h1>
      <p className="mt-1 text-sm text-ink/60">Three songs that fit this video. Tap one to use it.</p>
      <div className="mt-6 flex flex-col gap-4">
        {recommendations.map((r) => (
          <RecommendationCard
            key={r.rank}
            rec={{ ...r, selected: selected === r.rank, rejected: rejected.has(r.rank) }}
            chosen={selected === r.rank}
            collapsed={selected !== null && selected !== r.rank}
            onSelect={(rank) => setSelected(rank)}
            onReject={(rank) => setRejected((s) => new Set(s).add(rank))}
          />
        ))}
      </div>
      <p className="mt-8 text-center text-xs text-ink/50">Sections are our best estimate. Check it against the track.</p>
    </main>
  );
}
```

```tsx
// components/RecommendationCard.tsx
"use client";
import { useRef, useState } from "react";
import { formatTime } from "@/src/shared/format";
import type { RecommendationView } from "@/src/shared/types";

type Props = {
  rec: RecommendationView;
  chosen: boolean;
  collapsed: boolean;
  onSelect: (rank: number) => void;
  onReject: (rank: number) => void;
};

export function RecommendationCard({ rec, chosen, collapsed, onSelect, onReject }: Props) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const featured = rec.rank === 1;
  if (collapsed) return null;

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); } else { void el.play(); setPlaying(true); }
  };

  return (
    <article className={["rounded-2xl border border-ink/10 bg-white shadow-sm transition", featured ? "p-5" : "p-4", rec.rejected ? "opacity-40" : ""].join(" ")}>
      <div className="flex gap-4">
        {rec.artwork_url ? (
          <img src={rec.artwork_url} alt="" className={featured ? "h-24 w-24 rounded-xl object-cover" : "h-16 w-16 rounded-lg object-cover"} />
        ) : (
          <div className={featured ? "h-24 w-24 rounded-xl bg-ink/5" : "h-16 w-16 rounded-lg bg-ink/5"} />
        )}
        <div className="min-w-0 flex-1">
          <span className="inline-block rounded-full bg-steel/10 px-2 py-0.5 text-xs font-medium text-steel">#{rec.rank} {rec.direction_label}</span>
          <h2 className={featured ? "mt-1 truncate text-lg font-semibold text-ink" : "mt-1 truncate font-semibold text-ink"}>{rec.title}</h2>
          <p className="truncate text-sm text-ink/60">{rec.artist}</p>
          <p className="mt-2 text-base font-bold text-ink">Use {formatTime(rec.start_seconds)}–{formatTime(rec.end_seconds)}</p>
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
        <a href={rec.spotify_url} target="_blank" rel="noopener noreferrer" className="text-steel underline-offset-2 hover:underline">Open in Spotify</a>
      </div>

      {!chosen && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onSelect(rec.rank)} className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white">Use this</button>
          <button type="button" onClick={() => onReject(rec.rank)} className="rounded-xl border border-ink/15 px-4 py-3 text-sm font-medium text-ink">Not for me</button>
        </div>
      )}
      {chosen && <p className="mt-4 text-sm font-medium text-steel">Chosen. Go make it.</p>}
    </article>
  );
}
```

Tailwind tokens `ink` and `steel` come from Phase 0's `tailwind.config.ts`.

- [ ] **Step 7: Check it renders**

Run: `pnpm typecheck && pnpm dev`, open `/results/<id of a ready submission>` at a 390 px viewport.
Expected: "Your Songfit", three cards with #1 larger, bold "Use m:ss–m:ss", no preview button (previews disabled), "Open in Spotify" opens a search in a new tab, "Use this" hides the other two, "Not for me" dims a card, the footer line is present. Refreshing does not log a second `recommendations_viewed` event. The JSON from `/api/submissions/<id>` contains no `component_scores`, `directions`, `anchor_seconds` or `deezer_id`.

- [ ] **Step 8: Commit**

```bash
git add src/shared/format.ts src/shared/views.ts tests/shared components/RecommendationCard.tsx components/ResultsView.tsx app/results app/api/submissions src/db/queries/submissions.ts
git commit -m "Add results page with RecommendationView-only cards"
```

---

### Task 3.12: Admin inspector: plain candidates table and final picks

**Files:**
- Create: `components/admin/CandidatesTable.tsx`
- Modify: `app/admin/submissions/[id]/page.tsx`

**Interfaces:**
- Consumes: `listCandidates` (Phase 0), `listRecommendations`, `requireAdmin` (Phase 1), the Phase 2 inspector page.
- Produces: nothing new for other tasks.

Ruling M1: a plain table, no presentation work.

- [ ] **Step 1: Write the table component**

```tsx
// components/admin/CandidatesTable.tsx
import { DIMENSIONS, type ComponentScores } from "@/src/shared/types";
import type { CandidateRow } from "@/src/db/queries/candidates";
import { formatTime } from "@/src/shared/format";

export function CandidatesTable({ rows }: { rows: CandidateRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left">
            <th className="p-1">#</th><th className="p-1">Song</th><th className="p-1">Dirs</th><th className="p-1">Verified</th>
            <th className="p-1">Anchor</th><th className="p-1">Window</th><th className="p-1">Total</th>
            {DIMENSIONS.map((d) => <th key={d} className="p-1">{d.slice(0, 4)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const scores = r.component_scores as ComponentScores | null;
            return (
              <tr key={r.id} className={r.verified ? "" : "text-gray-400"}>
                <td className="p-1">{i + 1}</td>
                <td className="p-1" title={`${r.section_reason} / ${r.fit_reason}`}>{r.canonical_title ?? r.title} — {r.canonical_artist ?? r.artist}</td>
                <td className="p-1">{(r.directions ?? []).join(",")}</td>
                <td className="p-1">{r.verified ? "yes" : "no"}</td>
                <td className="p-1">{formatTime(Number(r.anchor_seconds))}</td>
                <td className="p-1">{formatTime(Number(r.proposed_start))}–{formatTime(Number(r.proposed_end))}</td>
                <td className="p-1 font-mono">{r.total_score === null ? "—" : Number(r.total_score).toFixed(2)}</td>
                {DIMENSIONS.map((d) => {
                  const s = scores?.[d];
                  return <td key={d} className="p-1 font-mono" title={s?.reason ?? ""}>{s ? s.score.toFixed(2) : "—"}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Add the sections to the inspector page**

In `app/admin/submissions/[id]/page.tsx` (Phase 2), after the brief/transcript sections:

```tsx
import { listCandidates } from "@/src/db/queries/candidates";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { CandidatesTable } from "@/components/admin/CandidatesTable";
import { formatTime } from "@/src/shared/format";

// inside the component, after loading the submission (requireAdmin() already ran in this page per M3):
const [candidates, recs] = await Promise.all([listCandidates(id), listRecommendations(id)]);

// JSX:
<section className="mt-8">
  <h2 className="text-lg font-semibold">Final 3</h2>
  {recs.length === 0 ? <p className="text-sm text-gray-500">none yet</p> : (
    <ol className="mt-2 space-y-2 text-sm">
      {recs.map((r) => (
        <li key={r.id}>
          <b>#{r.rank} {r.direction_label}</b>: {r.title} — {r.artist}, use {formatTime(Number(r.start_seconds))}–{formatTime(Number(r.end_seconds))}
          {r.aligned_to_moment !== null && <span className="text-gray-500"> (aligned to {r.aligned_to_moment}s)</span>}
          <div className="text-gray-600">{r.explanation}</div>
        </li>
      ))}
    </ol>
  )}
</section>
<section className="mt-8">
  <h2 className="text-lg font-semibold">Candidates ({candidates.length}, {candidates.filter((c) => c.verified).length} verified)</h2>
  <CandidatesTable rows={candidates} />
</section>
```

- [ ] **Step 3: Check it renders**

Run: `pnpm typecheck && pnpm dev`, open `/admin/submissions/<id>` as the admin.
Expected: "Final 3" with alignment notes where present, and a candidates table sorted by total with unverified rows greyed out; hovering a score shows its reason; hovering a song shows both reasons.

- [ ] **Step 4: Commit**

```bash
git add components/admin/CandidatesTable.tsx app/admin/submissions
git commit -m "Show candidates with anchors, directions and component scores in admin inspector"
```

---

### Phase 3 demo check

Do this with real keys in `.env.local` against the hosted Supabase project.

- [ ] 1. Upload a real 20–60 s Reel from the upload screen (Phase 1 flow). Note the submission id from the URL.
- [ ] 2. Watch the logs: three `candidates.direction` lines, `verifyCandidates { total: ~70, verified: ~50-60, providerErrors: 0 }`, `scoring { ms, candidates }`, `explain { ms }`, then `recommendations_ready` with `ms`. Target: under 120 s end to end.
- [ ] 3. Results page: 3 real songs. For each, open the Spotify link and confirm the song exists by that artist. In admin, confirm `start_seconds < end_seconds <= duration_seconds` and that the anchor lies inside the window.
- [ ] 4. Admin inspector: ~60 scored rows plus greyed unverified rows; all three directions represented among verified rows; scores not clustered (if they sit at 0.7, tighten the "use the full range" instruction and bump `PROMPT_VERSION` to `scoring-v3`).
- [ ] 5. Per-stage cost and latency: from the `model.call` log lines (tokens, stop reason) and the Anthropic console, record input/output tokens and dollars for candidates (3 calls), scoring (1), explain (1), plus Whisper and analysis from Phase 2. Write the per-run total and elapsed time into `docs/RESEARCH.md` under a dated entry "First end-to-end run". If a stop reason is `max_tokens`, raise the stage's `maxTokens` and note it.
- [ ] 6. Run the full gate: `pnpm typecheck && pnpm test && pnpm build`. Expected: all green, build succeeds.
- [ ] 7. Commit any prompt tweaks with bumped `PROMPT_VERSION` constants.
