import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SongRow } from "@/components/picker/SongRow";
import { CandidatesTable } from "@/components/admin/CandidatesTable";
import type { CandidateRow } from "@/src/db/queries/candidates";

const row = {
  rank: 2, direction_label: "Safe bet", title: "A Very Long Song Title", artist: "Artist", start_seconds: 43, end_seconds: 58,
  explanation: "e", artwork_url: null, spotify_url: "s", deezer_url: null, deezer_id: "7", preview_url: null, selected: false, rejected: false,
};
const noop = () => {};
const songRow = (hasSample: boolean) =>
  renderToStaticMarkup(createElement(SongRow, {
    row, hasSample, active: false, playing: false, sounding: false, progress: null, chosen: false, pick: false,
    rejected: false, showActions: true, divider: false, explanationOpen: false, note: null,
    onPlay: noop, onPause: noop, onReject: noop, onChoose: noop, onToggleExplanation: noop,
  }));

describe("SongRow sample note", () => {
  it("shows a muted note and no Play button when the sample is unavailable", () => {
    const html = songRow(false);
    expect(html).toContain("Sample unavailable right now");
    expect(html).not.toContain("No sample");
    expect(html).not.toContain(`aria-label="Play ${row.title}"`);
  });
  it("shows the Play button and no note when the sample is there", () => {
    const html = songRow(true);
    expect(html).not.toContain("Sample unavailable right now");
    expect(html).toContain(`aria-label="Play ${row.title}"`);
  });
});

const cand = (over: Partial<CandidateRow>) => ({
  id: "c", title: "T", artist: "A", canonical_title: null, canonical_artist: null, directions: ["safe"], verified: false,
  deezer_id: null, anchor_seconds: 45, proposed_start: 43, proposed_end: 58, total_score: null, component_scores: null,
  section_reason: "", fit_reason: "", ...over,
}) as CandidateRow;

describe("CandidatesTable Verified column", () => {
  it("labels yes, no sample (a Deezer match without a preview) and no", () => {
    const html = renderToStaticMarkup(createElement(CandidatesTable, {
      rows: [cand({ id: "1", verified: true, deezer_id: "1" }), cand({ id: "2", deezer_id: "9" }), cand({ id: "3" })],
    }));
    const cells = [...html.matchAll(/<td class="p-1">(yes|no sample|no)<\/td>/g)].map((m) => m[1]);
    expect(cells).toEqual(["yes", "no sample", "no"]);
  });
});
