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
// A direction must return at least LIMITS.candidatesPerDirection − 5 (= 20) items to be accepted.
const many = (prefix: string, n = 20, artist = "X") => Array.from({ length: n }, (_, i) => item(`${prefix} ${i}`, artist));

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
    const r = parseCandidateList("```json\n" + JSON.stringify(many("A")) + "\n```", "unexpected");
    expect(r.ok && r.items[0]!.directions).toEqual(["unexpected"]);
    expect(r.ok && r.items).toHaveLength(20);
  });
  it("rejects the list when dropping malformed items leaves too few", () => {
    const r = parseCandidateList(JSON.stringify([...many("A", 19), { title: "Bad", artist: "C" }]), "safe");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/at least 20/);
    expect(!r.ok && r.error).toMatch(/proposed_start|anchor_seconds|section_is_vocal/);
  });
  it("drops a malformed item when enough valid items remain", () => {
    const r = parseCandidateList(JSON.stringify([...many("A", 20), { title: "Bad", artist: "C" }]), "safe");
    expect(r.ok).toBe(true);
    expect(r.ok && r.items).toHaveLength(20);
  });
  it("rejects a list that is too short", () => {
    const r = parseCandidateList(JSON.stringify(many("A", 5)), "safe");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/at least 20/);
  });
  it("rejects prose", () => {
    expect(parseCandidateList("sorry, no", "safe").ok).toBe(false);
  });
});

describe("generateCandidates", () => {
  it("makes three calls and merges results", async () => {
    const call = vi.fn(async ({ user }: { user: string }) => {
      const dir = user.includes("DIRECTION: safe") ? "safe" : user.includes("DIRECTION: current") ? "current" : "unexpected";
      return JSON.stringify([...many(`${dir} song`, 19), item("Shared Song", "Y")]);
    });
    const out = await generateCandidates(brief, analysis, { call });
    expect(call).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(3 * 19 + 1); // "Shared Song" merged into one entry
    expect(out.find((c) => c.title === "Shared Song")!.directions).toEqual(["safe", "current", "unexpected"]);
  });
  it("retries a direction once with the validation error, then fails", async () => {
    const call = vi.fn(async ({ user }: { user: string }) =>
      user.includes("DIRECTION: safe") ? JSON.stringify([{ title: "Bad" }]) : JSON.stringify(many("ok")));
    await expect(generateCandidates(brief, analysis, { call })).rejects.toThrow(/candidate output invalid/);
    const safeCalls = call.mock.calls.filter((c) => (c[0] as { user: string }).user.includes("DIRECTION: safe"));
    expect(safeCalls).toHaveLength(2);
    expect((safeCalls[1]![0] as { user: string }).user).toMatch(/PREVIOUS OUTPUT WAS INVALID/);
  });
  it("retries a truncated direction once at low effort with the same prompt (round 1, finding 6)", async () => {
    let safeCalls = 0;
    const call = vi.fn(async ({ user }: { user: string; effort?: string }) => {
      if (user.includes("DIRECTION: safe") && safeCalls++ === 0) throw new Error("claude: output truncated at max_tokens");
      return JSON.stringify(many("ok"));
    });
    const out = await generateCandidates(brief, analysis, { call });
    expect(out).toHaveLength(20);
    const safe = call.mock.calls.map((c) => c[0]).filter((a) => a.user.includes("DIRECTION: safe"));
    expect(safe).toHaveLength(2);
    expect(safe[0]!.effort).toBe("medium");
    expect(safe[1]!.effort).toBe("low");
    expect(safe[1]!.user).toBe(safe[0]!.user);
    expect(call).toHaveBeenCalledTimes(4);
  });
  it("rethrows when the low-effort retry is truncated too, and never retries other errors", async () => {
    const truncated = vi.fn(async ({ user }: { user: string }) => {
      if (user.includes("DIRECTION: safe")) throw new Error("claude: output truncated at max_tokens");
      return JSON.stringify(many("ok"));
    });
    await expect(generateCandidates(brief, analysis, { call: truncated })).rejects.toThrow(/truncated at max_tokens/);
    expect(truncated.mock.calls.filter((c) => c[0].user.includes("DIRECTION: safe"))).toHaveLength(2);
    const other = vi.fn(async ({ user }: { user: string }) => {
      if (user.includes("DIRECTION: safe")) throw new Error("claude: no text in response");
      return JSON.stringify(many("ok"));
    });
    await expect(generateCandidates(brief, analysis, { call: other })).rejects.toThrow(/no text/);
    expect(other.mock.calls.filter((c) => c[0].user.includes("DIRECTION: safe"))).toHaveLength(1);
  });
  it("derives timeoutMs from ctx", async () => {
    const call = vi.fn(async (_a: { timeoutMs?: number }) => JSON.stringify(many("z")));
    await generateCandidates(brief, analysis, { call, ctx: { deadlineAt: Date.now() + 60_000 } });
    const t = call.mock.calls[0]![0].timeoutMs!;
    expect(t).toBeLessThanOrEqual(55_000);
    expect(t).toBeGreaterThan(5_000);
  });
  it("includes the note and the exclusion list when given", () => {
    const p = buildCandidatePrompt("safe", brief, analysis, { note: "avoid previous list", exclude: ["stay|the kid laroi"] });
    expect(p).toContain("avoid previous list");
    expect(p).toContain("Stay — The Kid Laroi");
  });
  it("states the video duration, or unknown when it is missing", () => {
    expect(buildCandidatePrompt("safe", brief, { ...analysis, duration_seconds: 4.5 })).toContain("Duration: 4.5s");
    expect(buildCandidatePrompt("safe", brief, analysis)).toContain("Duration: unknown");
  });
  it("states the window rules and renders exclusions in human form", () => {
    const p = buildCandidatePrompt("safe", brief, analysis, { exclude: ["stay|the kid laroi|sped up"] });
    expect(p).toContain("between 12 and 20");
    expect(p).toContain("anchor_seconds must lie inside the window");
    expect(p).toContain("Do NOT propose these songs (already considered):");
    expect(p).toContain("Stay — The Kid Laroi (sped up)");
  });
  it("recomputes timeoutMs for the retry", async () => {
    let n = 0;
    const call = vi.fn(async (a: { user: string; timeoutMs?: number }) => {
      if (a.user.includes("DIRECTION: safe") && n++ === 0) { await new Promise((r) => setTimeout(r, 30)); return "[]"; }
      return JSON.stringify(many("ok"));
    });
    await generateCandidates(brief, analysis, { call, ctx: { deadlineAt: Date.now() + 60_000 } });
    const safe = call.mock.calls.map((c) => c[0]).filter((a) => a.user.includes("DIRECTION: safe"));
    expect(safe[1]!.timeoutMs!).toBeLessThanOrEqual(safe[0]!.timeoutMs!);
  });
});

describe("SYSTEM_PROMPT (candidates-v8)", () => {
  it("covers the creator's note and named songs or artists", async () => {
    const { SYSTEM_PROMPT: sp, PROMPT_VERSION: v } = await import("@/src/engine/candidates/generateCandidates");
    expect(v).toBe("candidates-v8");
    expect(sp).toContain("When the caption, the story or the creator's note in the brief names a concrete thing (money, work, birthday, waiting, searching), include several songs whose title or hook says it.");
    expect(sp).toContain("If the brief names a song or artist from the creator, include that exact song if real and use it as the reference; at most 3 songs by a named artist.");
  });
  it("asks for the songs creators actually use, and keys the guidance on the music's job, not on speech (v8)", async () => {
    const { SYSTEM_PROMPT: sp } = await import("@/src/engine/candidates/generateCandidates");
    expect(sp).toContain("actually used for this kind of moment in the last two years, including the heavily used ones");
    expect(sp).toContain("For every job except quiet_bed, a famous, even overused song that does the job beats a tasteful obscure one");
    expect(sp).toContain("Someone talking does not by itself mean a quiet bed");
    for (const job of ["quiet_bed", "drive_energy", "emotional_lift", "comic_cue", "familiar_anthem"]) expect(sp).toContain(`- ${job}:`);
    expect(buildCandidatePrompt("safe", { ...brief, fields: { ...brief.fields, music_job: "drive_energy" } }, analysis)).toContain("Music's job: drive_energy");
    expect(buildCandidatePrompt("safe", brief, analysis)).toContain("Music's job: not stated (older analysis)");
    // v7: no example titles; v6 named four and one of them reached a third of all top 5s.
    expect(sp).not.toMatch(/klsr|American Dawn|Grant Steller|Max Richter/);
    // The unexpected direction still rules out meme-standard ironic picks, qualified for punchlines.
    const p = buildCandidatePrompt("unexpected", brief, analysis);
    expect(p).toContain("Not meme-standard ironic picks");
    expect(p).toContain("unless the video is a punchline and that exact song is the joke");
  });
});

describe("creator picks (experiment B, docs/review/24 v3)", () => {
  const picks = [{ title: "Mrs Magic", artist: "Strawberry Guy", deezer_id: "1", groups: 3, types: ["emotional" as const] }];
  it("offers the picks in the safe direction only, as recommendations, not usage", () => {
    const safe = buildCandidatePrompt("safe", brief, analysis, { creatorPicks: picks });
    expect(safe).toContain("CREATOR PICKS");
    expect(safe).toContain("- Mrs Magic — Strawberry Guy");
    expect(safe).toMatch(/recommend these songs for emotional videos/);
    expect(safe).toContain("skip the rest");
    expect(buildCandidatePrompt("current", brief, analysis, { creatorPicks: picks })).not.toContain("CREATOR PICKS");
  });
  it("leaves the production prompt unchanged when no picks are passed", () => {
    expect(buildCandidatePrompt("safe", brief, analysis, { creatorPicks: [] })).toBe(buildCandidatePrompt("safe", brief, analysis));
  });
  it("generates only the requested directions", async () => {
    const call = vi.fn().mockResolvedValue(JSON.stringify(many("S")));
    const out = await generateCandidates(brief, analysis, { call, directions: ["safe"], creatorPicks: picks });
    expect(call).toHaveBeenCalledTimes(1);
    expect(out.every((c) => c.directions.join() === "safe")).toBe(true);
  });
});

describe("model override (eval harness)", () => {
  it("uses MODELS.candidates by default and the override when given", async () => {
    const { MODELS } = await import("@/src/shared/config");
    const call = vi.fn().mockResolvedValue(JSON.stringify(many("S")));
    await generateCandidates(brief, analysis, { call, directions: ["safe"] });
    await generateCandidates(brief, analysis, { call, directions: ["safe"], model: MODELS.candidatesStrong });
    expect(call.mock.calls.map((c) => c[0].model)).toEqual([MODELS.candidates, MODELS.candidatesStrong]);
  });
});
