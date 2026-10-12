import { describe, it, expect, vi } from "vitest";
import { toCandidate, toScored, recommendSubmissionNew, type NewDeps } from "@/src/engine/match/recommendNew";
import type { SongEntry } from "@/src/engine/catalog/dictionary";
import { DIMENSIONS } from "@/src/shared/types";

const zero = { Motivational: 0, Inspirational: 0, Reflective: 0, Heartfelt: 0, Sad: 0, Nostalgic: 0, Funny: 0, Upbeat: 0, Hype: 0, "Calm/Focused": 0, Dramatic: 0 };
const song = (id: string, over: Partial<SongEntry> = {}): SongEntry => ({
  id, title: `T${id}`, artist: "A", year: 2020, feelings: { Sad: "high" }, energy: 0.4, valence: 0.3, tempo: 90, vocals: "instrumental",
  explicit: false, theme: null, flags: [], sections: { instrumental: false, first_vocal: 20, chorus: [40], gaps: [] }, creator_types: [], rank_pct: 0.95, ...over,
});
const profile = {
  reading: { talking: "on camera", words: { energy: 0.4, mood: 0.3 }, colour: { energy: 0.4, mood: 0.3 }, feelings: { ...zero, Sad: 1 },
    vocals: "instrumental preferred", themes_fit: [], themes_avoid: [], content_type: "Storytelling", story_feeling: "sad",
    key_moments: [{ time: 7, what: "turn" }], confidence: { feelings: "high", energy: "high", mood: "high", themes: "high" } },
  pacing: null, energy: 0.4, mood: 0.3,
};
const signals = { type: 1, mood: 0.9, creator: 0, lyrics: 0.5, vocals: 1, familiarity: 0.6, section: 1, feelings: 1 };

describe("new engine recommend step (behind ENGINE, Dylan 2026-10-11)", () => {
  it("turns a ranked song into a candidate with the picked section and a direction", () => {
    const c = toCandidate({ song: song("1"), total: 80, signals }, profile as never);
    expect(c).toMatchObject({ title: "T1", artist: "A", proposed_start: 0, proposed_end: 15, origin: "library", directions: ["safe"] });
  });

  it("keeps the old score shape (all 7 dimensions) so explain and the database are unchanged", () => {
    const s = toScored({ song: song("1"), total: 80, signals }, { verified_via: "deezer", catalog_key: "deezer:1", deezer_id: "1", itunes_id: null,
      canonical_title: "T1", canonical_artist: "A", duration_seconds: 200, artwork_url: null, deezer_url: null, preview_url: "p", ...toCandidate({ song: song("1"), total: 80, signals }, profile as never) });
    expect(Object.keys(s.component_scores).sort()).toEqual([...DIMENSIONS].sort());
    expect(s.total_score).toBeCloseTo(0.8, 5);
  });

  it("filters by feel button, ranks by closeness, verifies on Deezer, and saves rows marked engine 'new'", async () => {
    const songs = [song("1"), song("2"), song("3"), song("4", { feelings: { Funny: "high" } })];
    const saved: { cands?: unknown[]; recs?: unknown[] } = {};
    const deps: NewDeps = {
      songs,
      getSubmission: async () => ({ id: "s", creator_id: "c", duration_seconds: 20, vibe_tags: ["Sad Storytelling"] }) as never,
      getStored: async () => ({ analysis: { important_moments: [], dialogue_present: true } as never, brief: {} as never, profile: profile as never }),
      listNotFound: async () => [],
      verify: async (cands) => ({ verified: cands.map((c, i) => ({ ...c, verified_via: "deezer" as const, catalog_key: `deezer:${i}`, deezer_id: String(i), itunes_id: null, canonical_title: c.title, canonical_artist: c.artist, duration_seconds: 200, artwork_url: null, deezer_url: null, preview_url: "p" })), unverified: [], lookupFailed: [] }),
      explain: async (picks) => picks.map((p) => ({ ...p, explanation: "x", spotify_url: "s", itunes_id: null })),
      replaceCandidates: async (_id, rows) => { saved.cands = rows; return []; },
      replaceRecommendations: async (_id, rows) => { saved.recs = rows; return []; },
      setStatus: async () => {},
      logEvent: vi.fn(async () => {}) as never,
    };
    await recommendSubmissionNew("s", { deadlineAt: Date.now() + 60_000 }, deps);
    const titles = (saved.recs as { title: string; engine: string }[]).map((r) => r.title);
    expect(titles).not.toContain("T4"); // Funny song filtered out by the Sad Storytelling button
    expect(titles.length).toBe(3);
    expect((saved.recs as { engine: string }[]).every((r) => r.engine === "new")).toBe(true);
    expect((saved.cands as { engine: string }[]).every((r) => r.engine === "new")).toBe(true);
  });

  it("talking videos get only confirmed instrumental songs: no lyrics under talking (Dylan, 2026-10-12)", async () => {
    const songs = [song("1"), song("2"), song("3"), song("v", { vocals: "vocals" }), song("u", { vocals: "unknown" })];
    const saved: { recs?: { title: string }[] } = {};
    const deps = {
      songs,
      getSubmission: async () => ({ id: "s", creator_id: "c", duration_seconds: 20, vibe_tags: [] }) as never,
      getStored: async () => ({ analysis: { important_moments: [], dialogue_present: true } as never, brief: {} as never, profile: profile as never }),
      listNotFound: async () => [],
      verify: async (cands: { title: string; artist: string }[]) => ({ verified: cands.map((c, i) => ({ ...c, verified_via: "deezer" as const, catalog_key: `deezer:${i}`, deezer_id: String(i), itunes_id: null, canonical_title: c.title, canonical_artist: c.artist, duration_seconds: 200, artwork_url: null, deezer_url: null, preview_url: "p" })), unverified: [], lookupFailed: [] }),
      explain: async (picks: unknown[]) => (picks as object[]).map((p) => ({ ...p, explanation: "x", spotify_url: "s", itunes_id: null })),
      replaceCandidates: async () => [],
      replaceRecommendations: async (_id: string, rows: unknown[]) => { saved.recs = rows as { title: string }[]; return []; },
      setStatus: async () => {},
      logEvent: vi.fn(async () => {}) as never,
    } as unknown as NewDeps;
    await recommendSubmissionNew("s", { deadlineAt: Date.now() + 60_000 }, deps);
    const titles = saved.recs!.map((r) => r.title);
    expect(titles).not.toContain("Tv");
    expect(titles).not.toContain("Tu");
    expect(titles.length).toBe(3);
  });

  it("songs Dylan removed are never recommended", async () => {
    const { REMOVED_SONG_IDS } = await import("@/src/engine/catalog/removed");
    expect(REMOVED_SONG_IDS.has("4029525441")).toBe(true); // Hourglass — D0d.
  });
});
