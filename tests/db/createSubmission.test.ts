import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/src/db/client", () => ({ createServiceClient: () => ({ rpc: m.rpc }) }));

import { createSubmission } from "@/src/db/queries/submissions";
import { PaywallError, SubmissionLimitError } from "@/src/shared/errors";

const input = { id: "11111111-1111-4111-8111-111111111111", creatorId: "c1", videoPath: "c1/x.mp4", creatorIntent: null };

describe("createSubmission maps create_submission() refusals", () => {
  it.each(["daily_limit", "global_limit"] as const)("%s → SubmissionLimitError", async (reason) => {
    m.rpc.mockResolvedValue({ data: null, error: { message: reason } });
    const err = await createSubmission(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SubmissionLimitError);
    expect((err as SubmissionLimitError).reason).toBe(reason);
  });
  it("needs_subscription → PaywallError; anything else rethrows", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "needs_subscription" } });
    await expect(createSubmission(input)).rejects.toBeInstanceOf(PaywallError);
    m.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(createSubmission(input)).rejects.toEqual({ message: "boom" });
  });
});
