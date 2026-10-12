import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ countSubmissionsSince: vi.fn() }));
vi.mock("@/src/db/queries/submissions", () => ({ countSubmissionsSince: m.countSubmissionsSince }));

import { checkUploadRate, dailyUploadLimit, uploadsLeft } from "@/src/billing/rateLimit";
import { LIMITS } from "@/src/shared/config";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const DAY_AGO = new Date(NOW - 24 * 3_600_000).toISOString();
let n = 0;
const creator = () => `c${++n}`; // fresh key per case: the in-memory burst store is module-level
/** Mocks the two counts: last 24 h and last minute. */
const counts = (day: number, minute: number) =>
  m.countSubmissionsSince.mockImplementation(async (_c: string, since: string) => (since === DAY_AGO ? day : minute));

beforeEach(() => m.countSubmissionsSince.mockReset());

describe("dailyUploadLimit", () => {
  it("is 3 for an anonymous viewer and 15 for a signed-in creator", () => {
    expect(LIMITS.dailyUploadsAnonymous).toBe(3);
    expect(dailyUploadLimit(true)).toBe(3);
    expect(dailyUploadLimit(false)).toBe(LIMITS.dailyUploadsPerCreator);
  });
});

describe("checkUploadRate", () => {
  it("caps a creator at 15 uploads a day", async () => {
    expect(LIMITS.dailyUploadsPerCreator).toBe(15);
    counts(15, 0);
    expect(await checkUploadRate(creator(), 15, NOW)).toBe("daily_limit");
  });
  it("caps an anonymous viewer at 3", async () => {
    counts(3, 0);
    expect(await checkUploadRate(creator(), 3, NOW)).toBe("daily_limit");
    counts(2, 0);
    expect(await checkUploadRate(creator(), 3, NOW)).toBe("ok");
  });
  it("allows under the daily cap", async () => {
    counts(9, 0);
    expect(await checkUploadRate(creator(), 10, NOW)).toBe("ok");
  });
  it("keeps the 5-per-minute burst limit, in the database and in memory", async () => {
    counts(5, 5);
    expect(await checkUploadRate(creator(), 10, NOW)).toBe("rate_limited");
    counts(0, 0);
    const c = creator();
    for (let i = 0; i < 5; i++) expect(await checkUploadRate(c, 10, NOW)).toBe("ok");
    expect(await checkUploadRate(c, 10, NOW)).toBe("rate_limited");
  });
});

describe("uploadsLeft", () => {
  it("is the cap minus the same 24 h count, never below 0", async () => {
    counts(3, 0);
    expect(await uploadsLeft("c", false, NOW)).toBe(12);
    expect(await uploadsLeft("c", true, NOW)).toBe(0);
    counts(17, 0);
    expect(await uploadsLeft("c", false, NOW)).toBe(0);
    expect(m.countSubmissionsSince).toHaveBeenCalledWith("c", DAY_AGO);
  });
});
