// Curated source (docs/review/24, v3): songs that creators who teach "background music for your Reels" recommend,
// per video type. Transcribed by Gemini from 8 screen-recorded Reels on 2026-10-09; resolved on Deezer the same day.
// Advice, not observed usage. Hand-maintained; a later adapter into song_trend_signals would be lossy (that table
// has no source groups or per-version evidence), so this file stays the record.

export const CREATOR_LISTS_VERSION = "creator-lists-2026-10-09";

export type ListType =
  | "educational" | "emotional" | "sad" | "upbeat" | "day_in_life" | "storytelling" | "funny" | "motivational";

/**
 * L1 abigaildaniellla (no categories), L2 gobird, L3 personalbrandlaunch "Background Music 101" (also posted by
 * real_domingo_/dexuscreative: counted once), L4 takase.exe, L5 martinwang, L6 kienobilfilms.
 * Dependence policy: L4 shares 12 of its 20 songs with L3, so an L4 mention of a song L3 also names counts as L3.
 */
export type SourceId = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

export type Mention = { source: SourceId; type: ListType | null }; // null: no category, or a category we drop

export type CreatorListEntry = {
  title_raw: string; // as transcribed
  title: string | null; // Deezer canonical title; null = unresolved, never offered or scored
  artist: string | null;
  deezer_id: string | null;
  note?: string;
  banned_for_generation?: boolean; // production-library stock: the candidates prompt forbids it
  mentions: Mention[];
};

const e = (title_raw: string, resolved: [string, string, string] | null, mentions: [SourceId, ListType | null][], extra: Partial<CreatorListEntry> = {}): CreatorListEntry => ({
  title_raw,
  title: resolved?.[0] ?? null,
  artist: resolved?.[1] ?? null,
  deezer_id: resolved?.[2] ?? null,
  mentions: mentions.map(([source, type]) => ({ source, type })),
  ...extra,
});

export const CREATOR_LISTS: CreatorListEntry[] = [
  // L1: no categories
  e("La Mudanza", ["LA MuDANZA", "Bad Bunny", "3171003141"], [["L1", null]]),
  e("Nissan Altima", ["NISSAN ALTIMA", "Doechii", "2959869931"], [["L1", null]]),
  e("Love Like This", ["Love Like This", "Faith Evans", "6917807"], [["L1", null]]),
  e("Come Around and Love Me", ["Come Around and Love Me", "Jalen Ngonda", "2172217327"], [["L1", null]]),
  e("Param-Pam-Pam", ["Param-Pam-Pam", "Carlos Campos", "863036212"], [["L1", null]]),
  // consensus
  e("Runaway", ["Runaway", "Kanye West", "7667065"], [["L2", "storytelling"], ["L3", "emotional"], ["L4", "motivational"], ["L5", "storytelling"]]),
  e("Dark Red", ["Dark Red", "Steve Lacy", "1860754817"], [["L2", "educational"], ["L3", "emotional"], ["L4", "emotional"], ["L5", "educational"]]),
  e("Money So Big", ["Monëy so big", "Yeat", "2174176987"], [["L2", "educational"], ["L3", "educational"], ["L4", "educational"]]),
  e("Mrs Magic", ["Mrs Magic", "Strawberry Guy", "1567152892"], [["L2", "emotional"], ["L5", "emotional"], ["L6", "emotional"]]),
  e("Karen 3", ["Karen 3", "Småland", "3001266701"], [["L2", "emotional"], ["L5", "emotional"]], { note: "only Deezer hit for the title" }),
  // New Home: three recordings named; evidence stays per version
  e("New Home", ["New Home", "Austin Farwell", "1370813962"], [["L5", "emotional"]]),
  e("New Home (Piano & Cello)", ["New Home (Piano & Cello)", "Austin Farwell", "3896792421"], [["L2", "emotional"]]),
  e("New Home (Slowed)", ["New Home (Slowed)", "Austin Farwell", "1386702612"], [["L3", "sad"]]),
  // L2
  e("Oppenheimer", null, [["L2", "storytelling"]], { note: "several Göransson score cues; unresolved" }),
  e("Good Man With a Broken Heart", ["a good man with a broken heart", "LoVibe.", "3515722251"], [["L2", "storytelling"]]),
  e("THANK YOU (The Creator)", null, [["L2", "educational"]], { note: "artist unclear; unresolved" }),
  e("Timeless (Instrumental)", ["Timeless (Instrumental)", "The Weeknd", "3354177051"], [["L2", "day_in_life"]]),
  e("Everybody Wants To Rule The World", null, [["L2", "day_in_life"]], { note: "only live/extended/sped-up versions on Deezer" }),
  e("Paper Planes", ["Paper Planes", "M.I.A.", "943376"], [["L2", "day_in_life"], ["L3", "day_in_life"]]),
  // L3
  e("Not Like Us", ["Not Like Us", "Kendrick Lamar", "2783963122"], [["L3", "educational"], ["L4", "educational"]]),
  e("Like That", ["Like That", "Future", "2715581062"], [["L3", "educational"], ["L4", null]]),
  e("20 Min", ["20 Min", "Lil Uzi Vert", "428537532"], [["L3", "educational"], ["L4", "educational"]]),
  e("Vampire Heart", null, [["L3", "educational"], ["L4", null]], { note: "Isak Roen or HIM; unresolved" }),
  e("Hell N Back", ["Hell N Back (feat. Summer Walker)", "Bakar", "2461123655"], [["L3", "educational"]]),
  e("Hotline Bling", ["Hotline Bling", "Drake", "124603286"], [["L3", "emotional"]]),
  e("Walking on a Dream", ["Walking On A Dream", "Empire Of The Sun", "687753172"], [["L3", "emotional"]]),
  e("Gibran Alcocer", null, [["L3", "emotional"]], { note: "artist only; track unknown (Idea 10?)" }),
  e("Low Key Gliding", ["Low Key Gliding", "Hal Walker", "3509790891"], [["L3", "emotional"]]),
  e("Thank You", null, [["L3", "upbeat"], ["L6", null]], { note: "ambiguous title; unresolved" }),
  e("Heart On My Sleeve", null, [["L3", "upbeat"]], { note: "ambiguous; unresolved" }),
  e("Young Folks", ["Young Folks", "Peter Bjorn And John", "4194903"], [["L3", "upbeat"]]),
  e("1901", ["1901", "Phoenix", "3026048721"], [["L3", "upbeat"]]),
  e("Million Dollar Baby", ["MILLION DOLLAR BABY", "Tommy Richman", "2827724612"], [["L3", "upbeat"], ["L4", null]]),
  e("Memory Reboot", ["Memory Reboot", "VØJ", "2097969447"], [["L3", "upbeat"], ["L6", "motivational"]]),
  e("Surround Sound", ["Surround Sound", "JID", "1993227377"], [["L3", "day_in_life"]]),
  e("Space Cadet", ["Space Cadet", "Metro Boomin", "578715472"], [["L3", "day_in_life"]]),
  e("Dem Guys / I Wanna Be Yours", null, [["L3", null]], { note: "copies of L3 disagree; Dylan to check" }),
  e("Loot / Lost", null, [["L3", null]], { note: "copies of L3 disagree; Dylan to check" }),
  e("Tell Kim / Tell Em", null, [["L3", null], ["L4", null]], { note: "copies disagree; L4 category dropped" }),
  e("Another Love", ["Another Love", "Tom Odell", "65723649"], [["L3", "sad"], ["L6", "storytelling"]]),
  e("Je te laisserai des mots", null, [["L3", "sad"]], { note: "Patrick Watson original not on Deezer" }),
  e("Frank Saint", null, [["L3", "sad"]], { note: "Comet, core², corecore; unresolved" }),
  e("Home", null, [["L3", "sad"]], { note: "ambiguous; unresolved" }),
  e("Plage Coquillage", ["Plage Coquillage (First Kiss Song)", "Tao mon amour", "3352903451"], [["L3", "sad"]]),
  // L4 (inspiring → motivational; energetic dropped)
  e("A Good Man", null, [["L4", "motivational"]], { note: "ambiguous; unresolved" }),
  e("Dragonfly", null, [["L4", "motivational"]], { note: "ambiguous; unresolved" }),
  e("Freedom", null, [["L4", "motivational"]], { note: "ambiguous; unresolved" }),
  e("Pink + White", ["Pink + White", "Frank Ocean", "717273862"], [["L4", "motivational"]]),
  e("Timeless", ["Timeless", "The Weeknd", "3210598501"], [["L4", "educational"]]),
  e("I Like The Way You Kiss Me", ["i like the way you kiss me", "Artemas", "2706736172"], [["L4", "educational"]]),
  e("Sprinter", ["Sprinter", "Dave", "3553677361"], [["L4", null]]),
  e("See You Again", null, [["L4", "emotional"]], { note: "Tyler, The Creator or Wiz Khalifa; unresolved" }),
  e("Feeling Blue", ["Feeling Blue", "Caleb Arredondo", "3037357851"], [["L4", "emotional"]], { note: "same artist as Echo Sax End in the same list" }),
  e("I Was Only Temporary", ["i was only temporary", "my head is empty", "2471204361"], [["L4", "emotional"]]),
  e("Echo Sax End", ["Echo Sax End", "Caleb Arredondo", "3037404581"], [["L4", "emotional"]]),
  // L5 (tactical → educational; deep → emotional; challenge dropped)
  e("Ylang Ylang", null, [["L5", "emotional"]], { note: "FKJ original not on Deezer" }),
  e("ELBM", ["Every Living Breathing Moment", "Grant Steller", "3354082071"], [["L5", "educational"]], { note: "acronym" }),
  e("New Computers", ["New Computers", "Girlfriends", "3597848872"], [["L5", "educational"]]),
  e("CYHTM", null, [["L5", null]]),
  e("Summer", null, [["L5", null]]),
  e("Deep Space Samurai", null, [["L5", null]]),
  e("Skyfall", ["Skyfall", "Adele", "82715364"], [["L5", "storytelling"]]),
  e("Missing Textures", ["Missing Textures", "NIVEK FFORHS", "2737836391"], [["L5", "storytelling"]]),
  e("Peer Pressure", null, [["L5", "emotional"]], { note: "James Bay or others; unresolved" }),
  e("Dimensions", null, [["L5", "emotional"]], { note: "ambiguous; unresolved" }),
  // L6 (6-second text reel dropped)
  e("7 Years", null, [["L6", "storytelling"]], { note: "Lukas Graham original not on Deezer" }),
  e("End of August", null, [["L6", "storytelling"]], { note: "ambiguous; unresolved" }),
  e("Sneaky Snitch", ["Sneaky Snitch", "Kevin MacLeod", "2124280777"], [["L6", "funny"]], { banned_for_generation: true }),
  e("Fluffing a Duck", ["Fluffing a Duck", "Kevin MacLeod", "2124248167"], [["L6", "funny"]], { banned_for_generation: true }),
  e("Scheming Weasel", ["Scheming Weasel (Faster)", "Kevin MacLeod", "3919489751"], [["L6", "funny"]], { banned_for_generation: true }),
  e("Eyes Without a Face", ["Eyes Without A Face", "Billy Idol", "353398321"], [["L6", null]]),
  e("Dance (Instrumental)", null, [["L6", null]]),
  e("Metamorphosis", ["METAMORPHOSIS", "Interworld", "1655692952"], [["L6", "motivational"]]),
  e("Snowfall", ["snowfall", "Øneheart", "1596890022"], [["L6", "motivational"]]),
  e("In Love With Life", ["in love with life", "Ophelia Wilde", "4045436621"], [["L6", "emotional"]]),
  e("In This Shirt", ["In This Shirt", "The Irrepressibles", "1698799357"], [["L6", "emotional"]]),
];

/** The group a mention counts under (dependence policy above). */
export function groupOf(entry: CreatorListEntry, m: Mention): SourceId {
  return m.source === "L4" && entry.mentions.some((x) => x.source === "L3") ? "L3" : m.source;
}

/** Distinct source groups that recommend this entry for one of `types`. */
export function matchedGroups(entry: CreatorListEntry, types: readonly ListType[]): SourceId[] {
  const groups = new Set<SourceId>();
  for (const m of entry.mentions) if (m.type && types.includes(m.type)) groups.add(groupOf(entry, m));
  return [...groups].sort();
}

export type CreatorPick = { title: string; artist: string; deezer_id: string; groups: number; types: ListType[] };

export const SHORTLIST_MAX = 8;

/**
 * Songs to offer the candidates model for a clip of these types: resolved, not banned, at least one group for a
 * matching type, one per Deezer id; most groups first, then title (deterministic). Sample availability is checked
 * by verification like any other candidate.
 */
export function shortlistFor(types: readonly ListType[], lists: CreatorListEntry[] = CREATOR_LISTS, max = SHORTLIST_MAX): CreatorPick[] {
  const byId = new Map<string, CreatorPick>();
  for (const entry of lists) {
    if (!entry.deezer_id || !entry.title || !entry.artist || entry.banned_for_generation) continue;
    const groups = matchedGroups(entry, types);
    if (groups.length === 0) continue;
    const matched = [...new Set(entry.mentions.flatMap((m) => (m.type && types.includes(m.type) ? [m.type] : [])))];
    const prev = byId.get(entry.deezer_id);
    if (!prev || groups.length > prev.groups) byId.set(entry.deezer_id, { title: entry.title, artist: entry.artist, deezer_id: entry.deezer_id, groups: groups.length, types: matched });
  }
  return [...byId.values()]
    .sort((a, b) => b.groups - a.groups || a.title.localeCompare(b.title))
    .slice(0, max);
}
