import { describe, it, expect } from "vitest";
import { extractJson, JsonExtractError } from "@/src/shared/json";

describe("extractJson", () => {
  it("parses a bare object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a bare array", () => {
    expect(extractJson('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("strips a ```json fence", () => {
    expect(extractJson('```json\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  it("finds JSON wrapped in prose", () => {
    expect(extractJson('Sure! Here it is:\n{"ok":true}\nLet me know.')).toEqual({ ok: true });
  });

  it("throws JsonExtractError carrying the raw text on invalid JSON", () => {
    const raw = "{not json";
    try {
      extractJson(raw);
      throw new Error("expected extractJson to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(JsonExtractError);
      expect((e as JsonExtractError).raw).toBe(raw);
      expect((e as JsonExtractError).message).toMatch(/invalid JSON/);
    }
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractJson("")).toThrow(/no JSON value/);
    expect(() => extractJson("no braces here")).toThrow(/no JSON value/);
  });
});
