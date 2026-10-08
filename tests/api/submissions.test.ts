import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  getCreator: vi.fn(), getSubmission: vi.fn(), createSubmission: vi.fn(), countSubmissionsForCreator: vi.fn(),
  logEvent: vi.fn(), objectInfo: vi.fn(), runSubmission: vi.fn(),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: () => undefined }));
vi.mock("@/src/auth/session", () => ({ getCreator: m.getCreator }));
vi.mock("@/src/db/queries/submissions", () => ({
  getSubmission: m.getSubmission, createSubmission: m.createSubmission, countSubmissionsForCreator: m.countSubmissionsForCreator,
}));
vi.mock("@/src/feedback/events", () => ({ logEvent: m.logEvent }));
vi.mock("@/src/media/storage", () => ({ isExactStoragePath: () => true, objectInfo: m.objectInfo }));
vi.mock("@/src/pipeline/run", () => ({ runSubmission: m.runSubmission }));

import { POST } from "@/app/api/submissions/route";

const ID = "11111111-1111-4111-8111-111111111111";
const post = () => POST(new Request("http://x/api/submissions", {
  method: "POST",
  body: JSON.stringify({ submissionId: ID, path: `c1/${ID}.mp4`, ext: "mp4" }),
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
});

describe("POST /api/submissions: returned_with_second_submission", () => {
  it.each([[1, false], [2, true], [3, false], [7, false]])("count %i → fires %s", async (count, fires) => {
    m.countSubmissionsForCreator.mockResolvedValue(count);
    expect((await post()).status).toBe(201);
    expect(names().includes("returned_with_second_submission")).toBe(fires);
  });
});
