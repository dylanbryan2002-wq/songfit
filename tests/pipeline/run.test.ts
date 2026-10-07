import { describe, it, expect, vi } from "vitest";
import { runSubmission } from "../../src/pipeline/run";
import { PipelineError } from "../../src/shared/errors";

function deps(over: Record<string, unknown> = {}) {
  const state = { hasAnalysis: false, hasRecs: false };
  const d = {
    claimSubmissionRun: vi.fn(async (_id: string): Promise<{ id: string; creator_id: string } | null> => ({ id: "sub-1", creator_id: "cre-1" })),
    getAnalysisRow: vi.fn(async () => (state.hasAnalysis ? { id: "an-1" } : null)),
    listRecommendations: vi.fn(async () => (state.hasRecs ? [{ id: "r1" }] : [])),
    setSubmissionStatus: vi.fn(async (_id: string, _status: string, _error?: string | null) => undefined),
    analyze: vi.fn(async (_id: string, _ctx: { deadlineAt: number }) => { state.hasAnalysis = true; }),
    recommend: vi.fn(async (_id: string, _ctx: { deadlineAt: number }) => { state.hasRecs = true; }),
    logEvent: vi.fn(async (_e: { name: string; submissionId?: string | null; creatorId?: string | null; metadata?: unknown }) => undefined),
    now: () => 0,
    ...over,
  };
  return { d, state };
}

describe("runSubmission", () => {
  it("is a no-op when the claim fails (another run is in flight or the row is ready)", async () => {
    const { d } = deps();
    d.claimSubmissionRun.mockResolvedValue(null);
    await runSubmission("sub-1", d);
    expect(d.analyze).not.toHaveBeenCalled();
    expect(d.recommend).not.toHaveBeenCalled();
    expect(d.setSubmissionStatus).not.toHaveBeenCalled();
  });

  it("runs analyze then recommend, in order, and ends ready", async () => {
    const { d } = deps();
    const order: string[] = [];
    d.analyze.mockImplementation(async () => { order.push("analyze"); });
    d.recommend.mockImplementation(async () => { order.push("recommend"); });
    await runSubmission("sub-1", d);
    expect(order).toEqual(["analyze", "recommend"]);
    const statuses = d.setSubmissionStatus.mock.calls.map((c) => c[1]);
    expect(statuses).toEqual(["analyzing", "recommending", "ready"]);
  });

  it("threads a deadline into every stage", async () => {
    const { d } = deps({ now: () => 1_000 });
    await runSubmission("sub-1", d);
    const ctx = d.analyze.mock.calls[0]![1];
    expect(ctx).toEqual({ deadlineAt: expect.any(Number) });
    expect(ctx.deadlineAt).toBeGreaterThan(1_000);
    expect(d.recommend.mock.calls[0]![1]).toEqual(ctx);
  });

  it("skips analyze on retry when the analysis row exists", async () => {
    const { d, state } = deps();
    state.hasAnalysis = true;
    await runSubmission("sub-1", d);
    expect(d.analyze).not.toHaveBeenCalled();
    expect(d.recommend).toHaveBeenCalledTimes(1);
    const statuses = d.setSubmissionStatus.mock.calls.map((c) => c[1]);
    expect(statuses).toEqual(["recommending", "ready"]);
  });

  it("marks ready without running anything when both outputs already exist", async () => {
    const { d, state } = deps();
    state.hasAnalysis = true;
    state.hasRecs = true;
    await runSubmission("sub-1", d);
    expect(d.analyze).not.toHaveBeenCalled();
    expect(d.recommend).not.toHaveBeenCalled();
    expect(d.setSubmissionStatus).toHaveBeenCalledTimes(1);
    expect(d.setSubmissionStatus).toHaveBeenCalledWith("sub-1", "ready", null);
  });

  it("records a failure in analyze with stage, error and creatorId, and does not throw", async () => {
    const { d } = deps();
    d.analyze.mockRejectedValue(new PipelineError("analyze", "video too long"));
    await expect(runSubmission("sub-1", d)).resolves.toBeUndefined();
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", "video too long");
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "pipeline_failed",
        submissionId: "sub-1",
        creatorId: "cre-1",
        metadata: { stage: "analyze", error: "video too long", raw: null },
      }),
    );
    expect(d.recommend).not.toHaveBeenCalled();
  });

  it("keeps the raw model output (truncated) in pipeline_failed metadata", async () => {
    const { d } = deps();
    const raw = "x".repeat(5000);
    d.analyze.mockRejectedValue(new PipelineError("analyze", "model output invalid", raw));
    await runSubmission("sub-1", d);
    const call = d.logEvent.mock.calls.find((c) => c[0].name === "pipeline_failed")!;
    expect(call[0].metadata).toEqual({ stage: "analyze", error: "model output invalid", raw: "x".repeat(4000) });
  });

  it("records a failure when the claim itself throws (no creatorId known)", async () => {
    const { d } = deps();
    d.claimSubmissionRun.mockRejectedValue(new Error("db unreachable"));
    await expect(runSubmission("sub-1", d)).resolves.toBeUndefined();
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", "db unreachable");
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: "pipeline_failed", submissionId: "sub-1", creatorId: null }),
    );
  });

  it("records a failure when reading stored outputs throws, as stage analyze", async () => {
    const { d } = deps();
    d.getAnalysisRow.mockRejectedValue(new Error("select failed"));
    await runSubmission("sub-1", d);
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ stage: "analyze", error: "select failed" }) }),
    );
    expect(d.analyze).not.toHaveBeenCalled();
  });

  it("records a failure in recommend as stage recommend, even for a plain Error", async () => {
    const { d } = deps();
    d.recommend.mockRejectedValue(new Error("deezer down"));
    await runSubmission("sub-1", d);
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { stage: "recommend", error: "deezer down", raw: null } }),
    );
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", "deezer down");
  });

  it("fails cleanly when the time budget is exhausted before a stage", async () => {
    let t = 0;
    const { d } = deps({ now: () => t });
    d.analyze.mockImplementation(async () => { t = 290_000; });
    await runSubmission("sub-1", d);
    expect(d.recommend).not.toHaveBeenCalled();
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", expect.stringMatching(/budget exceeded before recommend/));
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ stage: "recommend" }) }),
    );
  });

  it("still records failure if setSubmissionStatus itself throws once", async () => {
    const { d } = deps();
    d.analyze.mockRejectedValue(new Error("boom"));
    d.setSubmissionStatus.mockRejectedValueOnce(new Error("db hiccup")); // the 'analyzing' write fails
    await expect(runSubmission("sub-1", d)).resolves.toBeUndefined();
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "pipeline_failed" }));
  });
});
