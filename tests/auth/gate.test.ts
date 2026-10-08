import { describe, it, expect } from "vitest";
import { gateDecision } from "@/src/auth/gate";

const anon = { id: "a1", anonymous: true, admin: false };
const google = { id: "c1", anonymous: false, admin: false };
const sub = (status: string, creator_id: string) => ({ status, creator_id });

describe("gateDecision", () => {
  it("anonymous owner of a ready run sees the gate, never the picker", () => {
    expect(gateDecision(anon, sub("ready", "a1"))).toBe("gate");
  });
  it("anonymous owner of a run in flight or failed sees the waiting screen", () => {
    for (const s of ["uploaded", "analyzing", "recommending", "failed"]) expect(gateDecision(anon, sub(s, "a1"))).toBe("waiting");
  });
  it("signed-in owner sees the picker when ready, waiting otherwise", () => {
    expect(gateDecision(google, sub("ready", "c1"))).toBe("picker");
    expect(gateDecision(google, sub("analyzing", "c1"))).toBe("waiting");
  });
  it("someone else's submission is not found, for anonymous and signed-in viewers", () => {
    expect(gateDecision(anon, sub("ready", "c1"))).toBe("not_found");
    expect(gateDecision(google, sub("ready", "a1"))).toBe("not_found");
  });
  it("an admin sees any submission", () => {
    expect(gateDecision({ ...google, admin: true }, sub("ready", "a1"))).toBe("picker");
  });
});
