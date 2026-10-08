import { describe, it, expect } from "vitest";
import {
  normalizeTitle, normalizeArtist, normalizeKey, titlesMatch, artistsMatch, versionTags,
  artistList, coreTitle, titleDescriptor, titlesMatchLoose, artistsMatchLoose,
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
    ["Song feat. X (Sped Up)", "Song", false],
    ["Song feat. X - Live", "Song", false],
    ["Song (Remix feat. X)", "Song", false],
    ["Song (Remix feat. X)", "Song (Remix)", true],
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

describe("loose matching (C1)", () => {
  it("artistList splits credits into normalised artists", () => {
    expect(artistList("Post Malone & Swae Lee")).toEqual(["post malone", "swae lee"]);
    expect(artistList("A, B and C x D feat. E")).toEqual(["a", "b", "c", "d", "e"]);
    expect(artistList("Drake ft. Rihanna")).toEqual(["drake", "rihanna"]);
    expect(artistList("Drake featuring Rihanna")).toEqual(["drake", "rihanna"]);
    expect(artistList("Drake with Rihanna")).toEqual(["drake", "rihanna"]);
    expect(artistList("Daft Punk")).toEqual(["daft punk"]);
  });
  it("coreTitle and titleDescriptor split at the first bracket or spaced dash", () => {
    expect(coreTitle("Dreams (2004 Remaster)")).toBe("dreams");
    expect(titleDescriptor("Dreams (2004 Remaster)")).toBe("(2004 remaster)");
    expect(coreTitle("Blinding Lights - Live at the O2")).toBe("blinding lights");
    expect(titleDescriptor("Blinding Lights - Live at the O2")).toBe("- live at the o2");
    expect(coreTitle("Song [Remix]")).toBe("song");
    expect(coreTitle("Anti-Hero")).toBe("anti hero");
    expect(titleDescriptor("Anti-Hero")).toBe("");
  });
  const titles: [string, string, boolean][] = [
    ["Dreams", "Dreams (2004 Remaster)", true],
    ["Running Up That Hill", "Running Up That Hill (A Deal With God)", true],
    ["Let It Go", 'Let It Go (From "Frozen"/Soundtrack Version)', true],
    ["Sunflower", "Sunflower (Spider-Man: Into the Spider-Verse)", true],
    ["Blinding Lights", "Blinding Lights", true],
    ["Mr. Brightside", "Mr. Brightside (Jacques Lu Cont's Thin White Duke Dub)", false],
    ["The Sound of Silence", "The Sound of Silence (Reprise)", false],
    ["Dreams", "Dreams (Live 1977)", false],
    ["Dreams", "Dreams - Acoustic Version", false],
    ["Dreams", "Dreams (Piano Version)", false],
    ["Cupid - Twin Ver.", "Cupid (Twin Version)", false], // candidate has its own descriptor: strict only
    ["Stay", "Stay With Me", false],
  ];
  it.each(titles)("titlesMatchLoose(%s, %s) = %s", (a, b, expected) => {
    expect(titlesMatchLoose(a, b)).toBe(expected);
  });
  const artists: [string, string, boolean][] = [
    ["Post Malone & Swae Lee", "Post Malone", true],
    ["Mark Ronson & Bruno Mars", "Mark Ronson", true],
    ["Lady Gaga & Bruno Mars", "Lady Gaga", true],
    ["Kendrick Lamar & SZA", "Kendrick Lamar", true],
    ["Beyoncé", "Beyonce", true],
    ["Adele", "Hello I'm Adele", false],
    ["Drake", "Rihanna", false],
  ];
  it.each(artists)("artistsMatchLoose(%s, %s) = %s", (a, b, expected) => {
    expect(artistsMatchLoose(a, b)).toBe(expected);
  });
});
