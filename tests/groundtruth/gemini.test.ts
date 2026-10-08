import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GEMINI_PROMPT, GeminiParseError, parseGeminiReply, readGeminiReply } from "../../scripts/groundtruth/gemini";
import { CONTENT_CATEGORIES } from "../../src/shared/config";

const reply = readFileSync("tests/groundtruth/fixtures/gemini-reply.md", "utf8");

describe("GEMINI_PROMPT", () => {
  it("is the file Dylan pastes, says it is a screen recording, and lists every content category", () => {
    expect(GEMINI_PROMPT).toBe(readFileSync("scripts/groundtruth/GEMINI_PROMPT.md", "utf8"));
    expect(GEMINI_PROMPT).toMatch(/screen recording/);
    expect(GEMINI_PROMPT).toContain(CONTENT_CATEGORIES.join(", "));
  });
});

describe("parseGeminiReply", () => {
  it("takes the first ```json block out of the pasted reply", () => {
    const parsed = parseGeminiReply(reply);
    expect(parsed.song).toEqual({ title: "Blinding Lights", artist: "The Weeknd", confidence: "high" });
    expect(parsed.music.role).toBe("amplify");
    expect(parsed.brief.tempo).toBe("medium");
  });

  it("ignores extra keys but rejects a missing or invalid listed key, with the raw text attached", () => {
    const withExtra = reply.replace('"summary":', '"extra": 1, "summary":');
    expect(parseGeminiReply(withExtra)).not.toHaveProperty("extra");
    const badEnergy = reply.replace('"energy": "low"', '"energy": "loud"');
    expect(() => parseGeminiReply(badEnergy)).toThrow(/energy/);
    try {
      parseGeminiReply(badEnergy);
    } catch (e) {
      expect(e).toBeInstanceOf(GeminiParseError);
      expect((e as GeminiParseError).raw).toBe(badEnergy);
    }
  });

  it("rejects a reply with no json block or broken JSON", () => {
    expect(() => parseGeminiReply("just prose")).toThrow(/no ```json block/);
    expect(() => parseGeminiReply("```json\n{ nope }\n```")).toThrow(/not valid JSON/);
  });
});

describe("readGeminiReply", () => {
  it("returns null when the clip has no pasted reply yet, else the parsed reply with the raw text", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "groundtruth-gemini-"));
    await fs.mkdir(path.join(root, "gemini"));
    expect(await readGeminiReply(root, "missing")).toBeNull();
    await fs.writeFile(path.join(root, "gemini", "hit.md"), reply);
    const got = await readGeminiReply(root, "hit");
    expect(got?.raw).toBe(reply);
    expect(got?.parsed.song.title).toBe("Blinding Lights");
    expect(got?.prompt_version).toBe("gemini-paste-v1");
    await fs.rm(root, { recursive: true, force: true });
  });
});
