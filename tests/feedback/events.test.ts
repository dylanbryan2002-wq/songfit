import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// vi.mock is hoisted above imports, so the mock fn must come from vi.hoisted.
const { insertEvent } = vi.hoisted(() => ({ insertEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/src/db/queries/events", () => ({ insertEvent }));

import { EVENT_NAMES, isEventName, logEvent } from "@/src/feedback/events";

/** Pulls the fenced list under "Allowed event names" out of docs/DATA_MODEL.md. */
function eventNamesFromDataModel(): string[] {
  const doc = readFileSync(path.join(process.cwd(), "docs", "DATA_MODEL.md"), "utf8");
  const start = doc.indexOf("Allowed event names");
  const fenceOpen = doc.indexOf("```", start);
  const fenceClose = doc.indexOf("```", fenceOpen + 3);
  const block = doc.slice(fenceOpen + 3, fenceClose);
  return block
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((name) => /^[a-z_0-9]+$/.test(name));
}

beforeEach(() => insertEvent.mockClear());

describe("EVENT_NAMES", () => {
  it("matches docs/DATA_MODEL.md exactly", () => {
    const documented = eventNamesFromDataModel();
    expect(documented.length).toBeGreaterThan(10);
    expect([...EVENT_NAMES].sort()).toEqual([...documented].sort());
  });

  it("isEventName guards unknown strings", () => {
    expect(isEventName("submission_created")).toBe(true);
    expect(isEventName("made_up_event")).toBe(false);
  });
});

describe("logEvent", () => {
  it("passes creatorId and submissionId through to the row", async () => {
    await logEvent({ name: "recommendations_ready", creatorId: "cre-1", submissionId: "sub-1", metadata: { ms: 90 } });
    expect(insertEvent).toHaveBeenCalledWith({
      name: "recommendations_ready",
      creator_id: "cre-1",
      submission_id: "sub-1",
      metadata: { ms: 90 },
    });
  });

  it("never throws when the insert fails", async () => {
    insertEvent.mockRejectedValueOnce(new Error("db down"));
    await expect(logEvent({ name: "paid" })).resolves.toBeUndefined();
  });
});
