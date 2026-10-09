import { describe, it, expect } from "vitest";
import { listTypesFor, ACTIVE_LIST_TYPES } from "@/src/engine/catalog/listTypes";
import { analysis as base, brief as baseBrief } from "../fixtures";
import type { VideoAnalysis } from "@/src/shared/types";

const a = (over: Partial<VideoAnalysis>): VideoAnalysis => ({ ...base, dialogue_present: true, mood: [], energy: "medium", ...over });
const b = (moods: string[] = []) => ({ ...baseBrief, fields: { ...baseBrief.fields, moods } });

describe("listTypesFor", () => {
  it("reads educational from the format words or informative moods", () => {
    expect(listTypesFor(a({ content_type: "talking-head productivity tutorial" }), b())).toEqual(["educational"]);
    expect(listTypesFor(a({ content_type: "talking head", mood: ["informative"] }), b())).toEqual(["educational"]);
  });
  it("reads storytelling from the format, but not for explainers or comedy", () => {
    expect(listTypesFor(a({ content_type: "talking-head storytime / founder vlog" }), b())).toEqual(["storytelling"]);
    expect(listTypesFor(a({ content_type: "explainer / real estate finance storytelling" }), b())).toEqual(["educational"]);
    expect(listTypesFor(a({ content_type: "comedic storytelling", mood: ["quirky"] }), b())).toEqual([]);
  });
  it("matches whole words only: 'history' is not 'story'", () => {
    expect(listTypesFor(a({ content_type: "history recap" }), b())).toEqual([]);
  });
  it("needs two emotional tags across analysis and brief, and calm energy", () => {
    expect(listTypesFor(a({ content_type: "monologue", mood: ["nostalgic"] }), b(["nostalgic"]))).toEqual([]);
    expect(listTypesFor(a({ content_type: "monologue", mood: ["nostalgic"] }), b(["tender"]))).toEqual(["emotional"]);
    expect(listTypesFor(a({ content_type: "monologue", mood: ["nostalgic", "tender"], energy: "medium-high" }), b())).toEqual([]);
  });
  it("reads motivational from mood tags, except on educational clips", () => {
    expect(listTypesFor(a({ content_type: "advice monologue", mood: ["motivational"] }), b())).toEqual(["motivational"]);
    expect(listTypesFor(a({ content_type: "tutorial", mood: ["motivational"] }), b())).toEqual(["educational"]);
  });
  it("treats mood tags as whole phrases: 'lightly comedic' is not comedic", () => {
    expect(listTypesFor(a({ content_type: "personal essay", mood: ["lightly comedic"] }), b())).toEqual(["storytelling"]);
  });
  it("never returns an inactive type", () => {
    const out = listTypesFor(a({ content_type: "day in the life vlog", mood: ["sad", "upbeat", "funny"], energy: "high" }), b());
    expect(out.every((t) => ACTIVE_LIST_TYPES.includes(t))).toBe(true);
  });
});
