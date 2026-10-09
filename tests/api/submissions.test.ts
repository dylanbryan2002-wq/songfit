import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  getViewer: vi.fn(), countSubmissionsSince: vi.fn(), getSubmission: vi.fn(), createSubmission: vi.fn(), countSubmissionsForCreator: vi.fn(), setSubmissionVibe: vi.fn(),
  logEvent: vi.fn(), objectInfo: vi.fn(), runSubmission: vi.fn(),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: () => undefined }));
vi.mock("@/src/auth/session", () => ({ getViewer: m.getViewer }));
vi.mock("@/src/db/queries/submissions", () => ({
  getSubmission: m.getSubmission, createSubmission: m.createSubmission, countSubmissionsForCreator: m.countSubmissionsForCreator,
  setSubmissionVibe: m.setSubmissionVibe, countSubmissionsSince: m.countSubmissionsSince,
}));
vi.mock("@/src/feedback/events", () => ({ logEvent: m.logEvent }));
vi.mock("@/src/media/storage", () => ({ isExactStoragePath: () => true, objectInfo: m.objectInfo }));
vi.mock("@/src/pipeline/run", () => ({ runSubmission: m.runSubmission }));

import { POST } from "@/app/api/submissions/route";
import { SubmissionLimitError } from "@/src/shared/errors";

const ID = "11111111-1111-4111-8111-111111111111";
const post = (extra: Record<string, unknown> = {}) => POST(new Request("http://x/api/submissions", {
  method: "POST",
  body: JSON.stringify({ submissionId: ID, path: `c1/${ID}.mp4`, ext: "mp4", ...extra }),
}));
const names = () => m.logEvent.mock.calls.map((c) => (c[0] as { name: string }).name);

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.getViewer.mockResolvedValue({ id: "c1", anonymous: false, email: "a@b.co" });
  m.countSubmissionsSince.mockResolvedValue(0);
  m.getSubmission.mockResolvedValue(null);
  m.objectInfo.mockResolvedValue({ sizeBytes: 1000 });
  m.createSubmission.mockResolvedValue({ id: ID });
  m.runSubmission.mockResolvedValue(undefined);
  m.logEvent.mockResolvedValue(undefined);
  m.setSubmissionVibe.mockResolvedValue(undefined);
});

describe("POST /api/submissions: returned_with_second_submission", () => {
  it.each([[1, false], [2, true], [3, false], [7, false]])("count %i → fires %s", async (count, fires) => {
    m.countSubmissionsForCreator.mockResolvedValue(count);
    expect((await post()).status).toBe(201);
    expect(names().includes("returned_with_second_submission")).toBe(fires);
  });
});

describe("POST /api/submissions: vibe", () => {
  const vibeEvent = () => m.logEvent.mock.calls.map((c) => c[0] as { name: string; metadata?: unknown }).find((e) => e.name === "vibe_set");

  it("skipping the vibe stores nothing and fires no vibe_set", async () => {
    expect((await post()).status).toBe(201);
    expect(m.setSubmissionVibe).not.toHaveBeenCalled();
    expect(m.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ creatorIntent: null }));
    expect(vibeEvent()).toBeUndefined();
  });

  it("empty tags and a whitespace note count as skipped", async () => {
    expect((await post({ vibe_tags: [], creatorIntent: "   " })).status).toBe(201);
    expect(m.setSubmissionVibe).not.toHaveBeenCalled();
    expect(m.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ creatorIntent: null }));
    expect(vibeEvent()).toBeUndefined();
  });

  it("stores tags and the trimmed note, and fires vibe_set once", async () => {
    expect((await post({ vibe_tags: ["Funny", "Educational"], creatorIntent: "  song is the punchline " })).status).toBe(201);
    expect(m.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ creatorIntent: "song is the punchline" }));
    expect(m.setSubmissionVibe).toHaveBeenCalledWith(ID, ["Funny", "Educational"]);
    expect(vibeEvent()).toEqual(expect.objectContaining({ metadata: { tags: ["Funny", "Educational"], has_note: true } }));
    expect(names().filter((n) => n === "vibe_set")).toHaveLength(1);
  });

  it("a note alone fires vibe_set with no tags", async () => {
    expect((await post({ creatorIntent: "make it sad" })).status).toBe(201);
    expect(m.setSubmissionVibe).not.toHaveBeenCalled();
    expect(vibeEvent()).toEqual(expect.objectContaining({ metadata: { tags: [], has_note: true } }));
  });

  it("rejects an unknown tag, a 4th tag and a note over 140 chars", async () => {
    expect((await post({ vibe_tags: ["Spooky"] })).status).toBe(400);
    expect((await post({ vibe_tags: ["Funny", "Educational", "Deep", "Romantic"] })).status).toBe(400);
    expect((await post({ creatorIntent: "a".repeat(141) })).status).toBe(400);
    expect(m.createSubmission).not.toHaveBeenCalled();
  });

  it("a failed vibe write still creates the submission, without vibe_set", async () => {
    m.setSubmissionVibe.mockRejectedValue(new Error("db down"));
    expect((await post({ vibe_tags: ["Deep"] })).status).toBe(201);
    expect(vibeEvent()).toBeUndefined();
  });
});

describe("POST /api/submissions: anonymous viewer", () => {
  beforeEach(() => m.getViewer.mockResolvedValue({ id: "c1", anonymous: true, email: null }));

  it("creates the run under the anonymous id, never a returned_with_second_submission", async () => {
    m.countSubmissionsForCreator.mockResolvedValue(2);
    expect((await post()).status).toBe(201);
    expect(m.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ creatorId: "c1" }));
    expect(names()).not.toContain("returned_with_second_submission");
  });

  it("429 daily_limit when create_submission() refuses on the daily cap", async () => {
    m.createSubmission.mockRejectedValue(new SubmissionLimitError("daily_limit"));
    const res = await post();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily_limit" });
    expect(m.runSubmission).not.toHaveBeenCalled();
    expect(names()).not.toContain("submission_created");
  });

  it("401 without any session", async () => {
    m.getViewer.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
  });
});

describe("POST /api/submissions: 24 h caps live in create_submission()", () => {
  it("429 global_limit when the site-wide ceiling is reached", async () => {
    m.createSubmission.mockRejectedValue(new SubmissionLimitError("global_limit"));
    const res = await post();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "global_limit" });
    expect(m.runSubmission).not.toHaveBeenCalled();
  });

  it("no longer pre-counts in the route (the database count is the atomic one)", async () => {
    m.countSubmissionsSince.mockResolvedValue(99);
    expect((await post()).status).toBe(201);
    expect(m.countSubmissionsSince).not.toHaveBeenCalled();
  });
});
