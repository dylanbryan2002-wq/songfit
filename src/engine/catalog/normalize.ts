// Conservative string matching (ruling I3). Both sides of every comparison go through the same
// functions. We fold case/diacritics and punctuation, strip featuring credits, and keep version
// words so "Stay (Sped Up)" never matches "Stay". "&" and "and" are deliberately NOT equated.

const VERSION_WORDS = [
  "sped up", "radio edit", "live", "remix", "acoustic", "slowed", "instrumental",
  "karaoke", "cover", "demo", "remastered", "remaster", "extended", "version",
] as const;
const SAME_RECORDING = new Set(["remaster", "radio edit"]); // same take, different master/cut

// Titles never treat "with" as a credit: "(A Deal With God)" is part of the song name.
// Only the feat clause itself is removed, never a version tag that follows or shares its bracket.
const FEAT_GROUP_RE = /([(\[])([^)\]]*)([)\]])/g;
const FEAT_IN_GROUP_RE = /\s*\b(?:feat\.?|ft\.?|featuring)(?=\s)[^)\]]*/i;
// Bare clause runs up to the next " - ", bracket, or end of string.
const FEAT_TAIL_TITLE_RE = /\s*\b(?:feat\.?|ft\.?|featuring)(?=\s)(?:(?!\s[-\u2013\u2014]\s|[(\[]).)*/gi;
const FEAT_PAREN_ARTIST_RE = /\s*[(\[][^)\]]*\b(?:feat\.?|ft\.?|featuring|with)\b[^)\]]*[)\]]/gi;

function stripTitleFeat(s: string): string {
  const grouped = s.replace(FEAT_GROUP_RE, (m, open: string, inner: string, close: string) => {
    if (!FEAT_IN_GROUP_RE.test(inner)) return m;
    const rest = inner.replace(FEAT_IN_GROUP_RE, "").trim();
    return rest ? `${open}${rest}${close}` : "";
  });
  return grouped.replace(FEAT_TAIL_TITLE_RE, "");
}
// Artists additionally treat "with" as a credit ("Drake with Rihanna"); titles must not ("Stay With Me").
const FEAT_TAIL_ARTIST_RE = /\s*\b(?:feat\.?|ft\.?|featuring|with)\s+.*$/i;

/** Lowercase, fold combining marks, keep letters/digits of any script, collapse the rest to spaces. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const TAG_RES = Object.fromEntries(
  VERSION_WORDS.map((w) => [w, new RegExp(`(^|\\s)${w}(\\s|$)`)]),
) as Record<(typeof VERSION_WORDS)[number], RegExp>;
const STRIP_RES = Object.fromEntries(
  VERSION_WORDS.map((w) => [w, new RegExp(`(^|\\s)${w}(?=\\s|$)`, "g")]),
) as Record<(typeof VERSION_WORDS)[number], RegExp>;

export function normalizeTitle(s: string): string {
  return fold(stripTitleFeat(s));
}

export function versionTags(title: string): Set<string> {
  const t = fold(title);
  const tags = new Set<string>();
  for (const w of VERSION_WORDS) {
    if (TAG_RES[w].test(t)) tags.add(w === "remastered" ? "remaster" : w);
  }
  return tags;
}

function stripVersionWords(normalized: string): string {
  let out = normalized;
  for (const w of VERSION_WORDS) out = out.replace(STRIP_RES[w], " ");
  return out.replace(/\s+/g, " ").trim();
}

export function normalizeArtist(s: string): string {
  return fold(s.replace(FEAT_PAREN_ARTIST_RE, "").replace(FEAT_TAIL_ARTIST_RE, ""));
}

function comparableTags(title: string): Set<string> {
  const tags = versionTags(title);
  for (const t of SAME_RECORDING) tags.delete(t);
  return tags;
}

/** Dedupe key. Version tags are part of the identity (I3): a live or sped-up take is a different recording. */
export function normalizeKey(title: string, artist: string): string {
  const tags = [...comparableTags(title)].sort().join(",");
  const base = `${stripVersionWords(normalizeTitle(title))}|${normalizeArtist(artist)}`;
  return tags ? `${base}|${tags}` : base;
}

export function titlesMatch(a: string, b: string): boolean {
  const na = stripVersionWords(normalizeTitle(a));
  const nb = stripVersionWords(normalizeTitle(b));
  if (!na || !nb || na !== nb) return false;
  const ta = comparableTags(a);
  const tb = comparableTags(b);
  if (ta.size !== tb.size) return false;
  for (const t of ta) if (!tb.has(t)) return false;
  return true;
}

export function artistsMatch(a: string, b: string): boolean {
  const na = normalizeArtist(a);
  const nb = normalizeArtist(b);
  return !!na && !!nb && na === nb;
}
