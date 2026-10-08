import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ countSubmissionsSince: vi.fn() }));
vi.mock("@/src/db/queries/submissions", () => ({ countSubmissionsSince: m.countSubmissionsSince }));

import { checkUploadRate } from "@/src/billing/rateLimit";
import { LIMITS } from "@/src/shared/config";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const DAY_AGO = new Date(NOW - 24 * 3_600_000).toISOString();
let n = 0;
const creator = () => `c${++n}`; // fresh key per case: the in-memory burst store is module-level
/** Mocks the two counts: last 24 h and last minute. */
const counts = (day: number, minute: number) =>
  m.countSubmissionsSince.mockImplementation(async (_c: string, since: string) => (since === DAY_AGO ? day : minute));

beforeEach(() => m.countSubmissionsSince.mockReset());

describe("checkUploadRate", () => {
  it("caps a creator at 10 uploads a day", async () => {
    expect(LIMITS.dailyUploadsPerCreator).toBe(10);
    counts(10, 0);
    expect(await checkUploadRate(creator(), NOW)).toBe("daily_limit");
  });
  it("allows under the daily cap", async () => {
    counts(9, 0);
    expect(await checkUploadRate(creator(), NOW)).toBe("ok");
  });
  it("keeps the 5-per-minute burst limit, in the database and in memory", async () => {
    counts(5, 5);
    expect(await checkUploadRate(creator(), NOW)).toBe("rate_limited");
    counts(0, 0);
    const c = creator();
    for (let i = 0; i < 5; i++) expect(await checkUploadRate(c, NOW)).toBe("ok");
    expect(await checkUploadRate(c, NOW)).toBe("rate_limited");
  });
});
