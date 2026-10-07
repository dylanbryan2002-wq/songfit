import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env, LIMITS, MODELS, CONTENT_CATEGORIES, PREVIEWS_ENABLED, FREE_RESULTS_PER_CREATOR } from "@/src/shared/config";

describe("env()", () => {
  const KEY = "SONGFIT_TEST_ENV_VAR";
  beforeEach(() => {
    delete process.env[KEY];
  });
  afterEach(() => {
    delete process.env[KEY];
  });

  it("returns the value when set", () => {
    process.env[KEY] = "hello";
    expect(env(KEY)).toBe("hello");
  });

  it("throws a clear error when missing", () => {
    expect(() => env(KEY)).toThrow(/SONGFIT_TEST_ENV_VAR/);
  });

  it("throws when set to an empty string", () => {
    process.env[KEY] = "";
    expect(() => env(KEY)).toThrow();
  });
});

describe("LIMITS and MODELS", () => {
  it("keeps section bounds sane", () => {
    expect(LIMITS.sectionMin).toBeLessThan(LIMITS.sectionDefault);
    expect(LIMITS.sectionDefault).toBeLessThan(LIMITS.sectionMax);
    expect(LIMITS.maxDurationSeconds).toBe(180);
  });
  it("has 'other' as a content category", () => {
    expect(CONTENT_CATEGORIES).toContain("other");
  });
  it("uses Fable only for video analysis", () => {
    expect(MODELS.analysis).toBe("claude-fable-5-1");
    expect(MODELS.candidates).toBe("claude-sonnet-5-5");
    expect(MODELS.scoring).toBe("claude-sonnet-5-5");
    expect(MODELS.explain).toBe("claude-sonnet-5-5");
  });
  it("ships with previews off and one free result", () => {
    expect(PREVIEWS_ENABLED).toBe(false);
    expect(FREE_RESULTS_PER_CREATOR).toBe(1);
  });
});
