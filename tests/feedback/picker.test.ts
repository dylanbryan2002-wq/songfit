import { describe, it, expect, vi, beforeEach } from "vitest";

const flags = vi.hoisted(() => ({ previews: true }));
vi.mock("@/src/shared/config", async (orig) => {
  const m = await orig<typeof import("@/src/shared/config")>();
  return { ...m, get PREVIEWS_ENABLED() { return flags.previews; } };
});
vi.mock("server-only", () => ({}));
const { listPickerRows, getSubmission } = vi.hoisted(() => ({ listPickerRows: vi.fn(), getSubmission: vi.fn() }));
vi.mock("@/src/db/queries/recommendations", () => ({ listPickerRows }));
vi.mock("@/src/db/queries/submissions", () => ({ getSubmission }));

import { toPickerRow, loadPicker } from "@/src/feedback/picker";
import { ProviderError } from "@/src/engine/catalog/deezer";
import type { PickerRecommendationRow } from "@/src/db/queries/recommendations";

const row = (rank: number, over: Record<string, unknown> = {}) => ({
  id: `r${rank}`, submission_id: "s1", candidate_id: `c${rank}`, rank, direction_label: "Best fit",
  title: `Song ${rank}`, artist: "Artist", start_seconds: "43.5", end_seconds: "58", explanation: "Why.",
  spotify_url: "https://open.spotify.com/search/x", deezer_url: null, artwork_url: null,
  preview_url: "https://stored/should-be-ignored.mp3", selected: false, rejected: false,
  created_at: "2026-10-07T00:00:00Z", explain_prompt_version: "v1", aligned_to_moment: null,
  candidates: { deezer_id: String(100 + rank) }, ...over,
}) as unknown as PickerRecommendationRow;

beforeEach(() => {
  flags.previews = true;
  listPickerRows.mockReset().mockResolvedValue([row(1), row(2), row(3)]);
  getSubmission.mockReset().mockResolvedValue({ id: "s1", duration_seconds: 12 });
});

describe("toPickerRow", () => {
  it("converts numerics, keeps nulls, ignores the stored preview and defaults flags to false", () => {
    const r = row(2, { selected: undefined, rejected: null, candidates: null });
    expect(toPickerRow(r, null)).toEqual({
      rank: 2, direction_label: "Best fit", title: "Song 2", artist: "Artist",
      start_seconds: 43.5, end_seconds: 58, explanation: "Why.", artwork_url: null,
      spotify_url: "https://open.spotify.com/search/x", deezer_url: null, deezer_id: null,
      preview_url: null, selected: false, rejected: false,
    });
    expect(toPickerRow(row(1), "https://fresh.mp3").preview_url).toBe("https://fresh.mp3");
  });
});

describe("loadPicker", () => {
  it("looks up each of the 3 rows and fills fresh preview urls", async () => {
    const lookup = vi.fn(async (id: string) => ({ kind: "ok" as const, previewUrl: `https://p/${id}.mp3` }));
    const out = await loadPicker("s1", { lookup });
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(out.video_duration_seconds).toBe(12);
    expect(out.rows.map((r) => r.preview_url)).toEqual(["https://p/101.mp3", "https://p/102.mp3", "https://p/103.mp3"]);
  });
  it("nulls only the row whose lookup fails and does not throw", async () => {
    const lookup = vi.fn(async (id: string) => {
      if (id === "102") throw new ProviderError("deezer 503", 503);
      return { kind: "ok" as const, previewUrl: `https://p/${id}.mp3` };
    });
    const out = await loadPicker("s1", { lookup });
    expect(out.rows.map((r) => r.preview_url)).toEqual(["https://p/101.mp3", null, "https://p/103.mp3"]);
  });
  it("nulls a row when Deezer has no preview", async () => {
    const lookup = vi.fn(async () => ({ kind: "none" as const }));
    const out = await loadPicker("s1", { lookup });
    expect(out.rows.every((r) => r.preview_url === null)).toBe(true);
  });
  it("makes no lookups when previews are disabled", async () => {
    flags.previews = false;
    const lookup = vi.fn();
    const out = await loadPicker("s1", { lookup });
    expect(lookup).not.toHaveBeenCalled();
    expect(out.rows.every((r) => r.preview_url === null)).toBe(true);
  });
});
