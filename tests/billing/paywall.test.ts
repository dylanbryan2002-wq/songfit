import { describe, expect, it } from "vitest";
import { decideCanSubmit } from "../../src/billing/paywall";

describe("decideCanSubmit (UX pre-check mirroring create_submission())", () => {
  it("allows the first submission with no subscription", () => {
    expect(decideCanSubmit(0, 0, false)).toEqual({ ok: true });
  });
  it("blocks a second submission without an active subscription", () => {
    expect(decideCanSubmit(1, 0, false)).toEqual({ ok: false, reason: "needs_subscription" });
    expect(decideCanSubmit(5, 0, false)).toEqual({ ok: false, reason: "needs_subscription" });
  });
  it("counts an in-flight submission against the free allowance", () => {
    expect(decideCanSubmit(0, 1, false)).toEqual({ ok: false, reason: "needs_subscription" });
  });
  it("allows any submission with an active subscription", () => {
    expect(decideCanSubmit(0, 0, true)).toEqual({ ok: true });
    expect(decideCanSubmit(9, 2, true)).toEqual({ ok: true });
  });
});
