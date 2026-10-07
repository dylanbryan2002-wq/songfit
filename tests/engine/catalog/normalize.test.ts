import { describe, it, expect } from "vitest";
import {
  normalizeTitle, normalizeArtist, normalizeKey, titlesMatch, artistsMatch, versionTags,
} from "@/src/engine/catalog/normalize";

describe("normalizeTitle", () => {
  it("lowercases, folds diacritics and collapses punctuation", () => {
    expect(normalizeTitle("Don't Stop Me Now!")).toBe("don t stop me now");
    expect(normalizeTitle("Señorita")).toBe("senorita");
  });
  it("strips featuring clauses only", () => {
    expect(normalizeTitle("Industry Baby (feat. Jack Harlow)")).toBe("industry baby");
    expect(normalizeTitle("Industry Baby feat. Jack Harlow")).toBe("industry baby");
  });
  it("keeps version words", () => {
    expect(normalizeTitle("Stay (Sped Up)")).toBe("stay sped up");
    expect(normalizeTitle("Blinding Lights - Remastered")).toBe("blinding lights remastered");
  });
  it("keeps non-Latin scripts", () => {
    expect(normalizeTitle("夜に駆ける")).toBe("夜に駆ける");
  });
});

describe("versionTags", () => {
  it("extracts tags from anywhere in the title", () => {
    expect([...versionTags("Stay (Sped Up)")]).toEqual(["sped up"]);
    expect([...versionTags("Blinding Lights - Live at the O2")]).toEqual(["live"]);
    expect([...versionTags("Blinding Lights")]).toEqual([]);
  });
});

describe("normalizeArtist", () => {
  it("keeps the primary artist and strips featuring", () => {
    expect(normalizeArtist("Drake feat. Rihanna")).toBe("drake");
    expect(normalizeArtist("Jawsh 685 featuring Jason Derulo")).toBe("jawsh 685");
  });
  it("never splits on and / & / x / commas", () => {
    expect(normalizeArtist("Florence + The Machine")).toBe("florence the machine");
    expect(normalizeArtist("Simon & Garfunkel")).toBe("simon garfunkel");
    expect(normalizeArtist("Of Monsters and Men")).toBe("of monsters and men");
  });
  it("folds diacritics and keeps non-Latin names", () => {
    expect(normalizeArtist("Beyoncé")).toBe("beyonce");
    expect(normalizeArtist("YOASOBI")).toBe("yoasobi");
    expect(normalizeArtist("宇多田ヒカル")).toBe("宇多田ヒカル");
  });
});

describe("matching (10 fixtures)", () => {
  const cases: [string, string, boolean][] = [
    ["Blinding Lights", "Blinding Lights - Remastered", true],
    ["Blinding Lights", "Blinding Lights (Radio Edit)", true],
    ["Stay", "Stay With Me", false],
    ["Stay (Sped Up)", "Stay", false],
    ["Stay", "Stay (Live)", false],
    ["Blinding Lights", "Save Your Tears", false],
    ["Industry Baby", "Industry Baby (feat. Jack Harlow)", true],
    ["Running Up That Hill", "Running Up That Hill (A Deal With God)", false],
    ["夜に駆ける", "夜に駆ける", true],
    ["", "", false],
  ];
  it.each(cases)("titlesMatch(%s, %s) = %s", (a, b, expected) => {
    expect(titlesMatch(a, b)).toBe(expected);
  });
  it("artistsMatch compares primary artists", () => {
    expect(artistsMatch("Beyoncé", "Beyonce")).toBe(true);
    expect(artistsMatch("Drake feat. Rihanna", "Drake")).toBe(true);
    expect(artistsMatch("Drake", "Rihanna")).toBe(false);
    expect(artistsMatch("Florence + The Machine", "Florence + the Machine")).toBe(true);
    expect(artistsMatch("宇多田ヒカル", "宇多田ヒカル")).toBe(true);
  });
  it("normalizeKey merges remaster/radio edit with the original (same recording)", () => {
    expect(normalizeKey("Blinding Lights - Remastered", "The Weeknd")).toBe("blinding lights|the weeknd");
    expect(normalizeKey("Blinding Lights", "The Weeknd")).toBe("blinding lights|the weeknd");
  });
  it("normalizeKey keeps real version tags so variants never dedupe together", () => {
    expect(normalizeKey("Stay (Sped Up)", "The Kid LAROI")).toBe("stay|the kid laroi|sped up");
    expect(normalizeKey("Stay", "The Kid LAROI")).toBe("stay|the kid laroi");
    expect(normalizeKey("Stay (Live)", "The Kid LAROI")).not.toBe(normalizeKey("Stay", "The Kid LAROI"));
  });
});
