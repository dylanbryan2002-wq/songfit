import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  getCreator: vi.fn(), getSubmission: vi.fn(), createSubmission: vi.fn(), countSubmissionsForCreator: vi.fn(), setSubmissionVibe: vi.fn(),
  logEvent: vi.fn(), objectInfo: vi.fn(), runSubmission: vi.fn(),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: () => undefined }));
vi.mock("@/src/auth/session", () => ({ getCreator: m.getCreator }));
vi.mock("@/src/db/queries/submissions", () => ({
  getSubmission: m.getSubmission, createSubmission: m.createSubmission, countSubmissionsForCreator: m.countSubmissionsForCreator,
  setSubmissionVibe: m.setSubmissionVibe,
}));
vi.mock("@/src/feedback/events", () => ({ logEvent: m.logEvent }));
vi.mock("@/src/media/storage", () => ({ isExactStoragePath: () => true, objectInfo: m.objectInfo }));
vi.mock("@/src/pipeline/run", () => ({ runSubmission: m.runSubmission }));

import { POST } from "@/app/api/submissions/route";

const ID = "11111111-1111-4111-8111-111111111111";
const post = (extra: Record<string, unknown> = {}) => POST(new Request("http://x/api/submissions", {
  method: "POST",
  body: JSON.stringify({ submissionId: ID, path: `c1/${ID}.mp4`, ext: "mp4", ...extra }),
}));
const names = () => m.logEvent.mock.calls.map((c) => (c[0] as { name: string }).name);

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.getCreator.mockResolvedValue({ id: "c1", email: "a@b.co" });
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
    expect(vibeEvent()).toBeUndefined();
  });

  it("blank tags and a whitespace note count as skipped", async () => {
    expect((await post({ vibe_tags: [], vibe_note: "   " })).status).toBe(201);
    expect(m.setSubmissionVibe).not.toHaveBeenCalled();
    expect(vibeEvent()).toBeUndefined();
  });

  it("stores tags + trimmed note and fires vibe_set once", async () => {
    expect((await post({ vibe_tags: ["Funny", "Chill"], vibe_note: "  song is the punchline " })).status).toBe(201);
    expect(m.setSubmissionVibe).toHaveBeenCalledWith(ID, { vibe_tags: ["Funny", "Chill"], vibe_note: "song is the punchline" });
    expect(vibeEvent()).toEqual(expect.objectContaining({ metadata: { tags: ["Funny", "Chill"], has_note: true } }));
    expect(names().filter((n) => n === "vibe_set")).toHaveLength(1);
  });

  it("rejects an unknown tag and a note over 140 chars", async () => {
    expect((await post({ vibe_tags: ["Spooky"] })).status).toBe(400);
    expect((await post({ vibe_note: "a".repeat(141) })).status).toBe(400);
    expect(m.createSubmission).not.toHaveBeenCalled();
  });

  it("a failed vibe write still creates the submission, without vibe_set", async () => {
    m.setSubmissionVibe.mockRejectedValue(new Error("db down"));
    expect((await post({ vibe_tags: ["Deep"] })).status).toBe(201);
    expect(vibeEvent()).toBeUndefined();
  });
});
