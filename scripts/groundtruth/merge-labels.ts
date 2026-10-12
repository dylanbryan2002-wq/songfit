/* Official song labels (Dylan, 2026-10-10; plan in ~/Songfit-groundtruth/design/song-labels.md).
     node --import tsx scripts/groundtruth/merge-labels.ts [--home ~/Songfit-groundtruth]
   Combines Claude's tags (library.json), ReccoBeats (reccobeats-all.json) and AcousticBrainz (acousticbrainz.json) into
   one row per song: feeling families with a confidence each, energy, tempo, vocals, explicit.
   Trust: energy and tempo from ReccoBeats; mood = Claude words checked against ReccoBeats valence/energy; vocals by vote.
   Number cut-offs are provisional until Dylan labels the check list (check-50.csv). */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

export const FAMILIES = ["Motivational", "Inspirational", "Reflective", "Heartfelt", "Sad", "Nostalgic", "Funny", "Upbeat", "Hype", "Calm/Focused", "Dramatic"] as const;
type Family = (typeof FAMILIES)[number];
type Conf = "high" | "medium" | "low" | "flagged";

/** Claude mood word -> feeling families. Words not listed (genre/style words) carry no feeling. */
const WORDS: Record<Family, string[]> = {
  // Motivational = push to act now (drive, swagger); Inspirational = uplifting, hopeful, awe (Dylan, 2026-10-11).
  Motivational: ["empowering", "defiant", "confident", "bold", "rebellious", "swaggering", "driving"],
  Inspirational: ["uplifting", "triumphant", "anthemic", "heroic", "soaring", "cathartic", "hopeful", "epic"],
  Reflective: ["reflective", "introspective", "contemplative", "wistful", "moody", "earnest", "yearning", "hazy"],
  Heartfelt: ["tender", "warm", "intimate", "soulful", "sweet", "emotional", "delicate", "romantic"],
  Sad: ["melancholic", "melancholy", "sad", "somber", "heartbroken", "bittersweet", "haunting"],
  Nostalgic: ["nostalgic", "retro", "bittersweet", "wistful"],
  Funny: ["playful", "quirky", "cheeky", "whimsical", "sassy", "fun", "bouncy", "flirty"],
  Upbeat: ["upbeat", "bright", "sunny", "breezy", "joyful", "groovy", "funky", "hopeful", "euphoric", "catchy", "tropical", "light", "danceable"],
  Hype: ["party", "club", "hype", "energetic", "aggressive", "driving", "hard", "rowdy", "swaggering", "boastful", "pulsing", "frantic", "intense", "heavy", "euphoric"],
  "Calm/Focused": ["calm", "chill", "laid-back", "relaxed", "serene", "smooth", "dreamy", "ethereal", "airy", "soft", "hushed", "lo-fi", "mellow", "hypnotic", "flowing", "gentle"],
  Dramatic: ["dramatic", "cinematic", "epic", "tense", "dark", "menacing", "urgent", "theatrical", "eerie", "brooding"],
};
/** Families the audio numbers can measure (research 2026-10-10), with provisional cut-offs on valence v and energy e. */
const MEASURED: Partial<Record<Family, (v: number, e: number) => boolean>> = {
  Hype: (_v, e) => e >= 0.8,
  Upbeat: (v, e) => v >= 0.6 && e >= 0.5,
  "Calm/Focused": (_v, e) => e <= 0.4,
  Sad: (v, e) => v <= 0.3 && e <= 0.55,
};

type Tags = { mood?: string[]; energy?: number; jobs?: string[]; lead_vocals?: string; era?: string; familiarity?: string; confidence?: string } | null;
type Lib = { deezer_id: string; title: string; artist: string; release_date: string | null; first_release: string | null; bpm: number | null; explicit: boolean; tags: Tags };
type Rb = { deezer_id: string; valence: number; energy: number; tempo: number; instrumentalness: number };
type Ab = { deezer_id: string; ab: Record<string, { value: string; probability: number }> | null };

export function claudeFamilies(t: Tags): Set<Family> {
  const words = new Set(t?.mood ?? []);
  const out = new Set<Family>(FAMILIES.filter((f) => WORDS[f].some((w) => words.has(w))));
  if (t?.jobs?.includes("comic_cue")) out.add("Funny");
  if (t?.jobs?.includes("quiet_bed")) out.add("Calm/Focused");
  return out;
}

export function labelSong(s: Lib, rb: Rb | undefined, ab: Ab["ab"] | undefined) {
  const knows = !!s.tags?.mood?.length && !s.tags.mood.includes("unknown");
  const said = knows ? claudeFamilies(s.tags) : new Set<Family>();
  const families: Partial<Record<Family, Conf>> = {};
  for (const f of FAMILIES) {
    const rule = MEASURED[f];
    const numbers = rb && rule ? rule(rb.valence, rb.energy) : undefined;
    if (said.has(f)) {
      if (numbers === undefined) families[f] = rb ? (f === "Motivational" && rb.energy < 0.5 ? "flagged" : "medium") : "low";
      else families[f] = numbers ? "high" : "flagged";
    } else if (numbers) families[f] = knows ? "flagged" : "low";
  }
  const claudeEnergy = s.tags?.energy ? (s.tags.energy - 1) / 4 : null;
  const energy = rb?.energy ?? claudeEnergy;
  const energyConf: Conf = rb && claudeEnergy !== null ? (Math.abs(rb.energy - claudeEnergy) <= 0.35 ? "high" : "flagged") : rb ? "medium" : "low";
  const votes: boolean[] = []; // true = has lead vocals
  if (s.tags?.lead_vocals === "yes" || s.tags?.lead_vocals === "no") votes.push(s.tags.lead_vocals === "yes");
  if (rb) votes.push(rb.instrumentalness < 0.5);
  const vi = ab?.voice_instrumental;
  if (vi && vi.probability >= 0.6) votes.push(vi.value === "voice");
  const yes = votes.filter(Boolean).length;
  const vocals = votes.length ? (yes * 2 > votes.length ? "vocals" : yes * 2 < votes.length ? "instrumental" : "unsure") : "unknown";
  const vocalsConf: Conf = votes.length < 2 ? "low" : yes === 0 || yes === votes.length ? "high" : "flagged";
  return {
    deezer_id: s.deezer_id, title: s.title, artist: s.artist,
    year: Number((s.first_release ?? s.release_date ?? "").slice(0, 4)) || null,
    families, energy: energy === null ? null : Math.round(energy * 100) / 100, energy_conf: energyConf,
    valence: rb ? Math.round(rb.valence * 100) / 100 : null,
    tempo: rb?.tempo ? Math.round(rb.tempo) : s.bpm || null,
    vocals, vocals_conf: vocalsConf, explicit: s.explicit,
    sources: [knows && "claude", rb && "reccobeats", ab && "acousticbrainz"].filter(Boolean),
  };
}

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const read = async (f: string) => JSON.parse(await fs.readFile(path.join(home, "catalog", f), "utf8"));
  const lib = (await read("library.json")) as Lib[];
  const rb = new Map(((await read("reccobeats-all.json")) as Rb[]).map((r) => [r.deezer_id, r]));
  const ab = new Map(((await read("acousticbrainz.json")) as Ab[]).filter((a) => a.ab).map((a) => [a.deezer_id, a.ab]));
  const rows = lib.map((s) => labelSong(s, rb.get(s.deezer_id), ab.get(s.deezer_id)));
  await fs.writeFile(path.join(home, "catalog", "song-labels.json"), JSON.stringify(rows));

  const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const fam = (r: (typeof rows)[number]) => Object.entries(r.families).map(([f, c]) => `${f} (${c})`).join("; ");
  await fs.writeFile(path.join(home, "catalog", "song-labels.csv"), [
    "title,artist,year,feelings,energy,energy_conf,valence,tempo,vocals,vocals_conf,explicit,sources",
    ...rows.map((r) => [r.title, r.artist, r.year, fam(r), r.energy, r.energy_conf, r.valence, r.tempo, r.vocals, r.vocals_conf, r.explicit, r.sources.join("+")].map(csv).join(",")),
  ].join("\n") + "\n");

  // Check list: 5 per family, flagged first, then high, spread across songs.
  const picked = new Set<string>(), check: string[][] = [];
  for (const f of FAMILIES) {
    const pool = rows.filter((r) => r.families[f] && !picked.has(r.deezer_id));
    const order = [...pool.filter((r) => r.families[f] === "flagged"), ...pool.filter((r) => r.families[f] === "high"), ...pool];
    for (const r of order) {
      if (check.filter((c) => c[0] === f).length >= 5) break;
      if (picked.has(r.deezer_id)) continue;
      picked.add(r.deezer_id);
      check.push([f, r.families[f]!, r.title, r.artist, String(r.year ?? ""), `https://www.deezer.com/track/${r.deezer_id}`, ""]);
    }
  }
  await fs.writeFile(path.join(home, "catalog", "check-50.csv"),
    ["family,engine_confidence,title,artist,year,listen,dylan_says_yes_or_no", ...check.map((c) => c.map(csv).join(","))].join("\n") + "\n");

  const count = (c: Conf) => rows.reduce((n, r) => n + Object.values(r.families).filter((x) => x === c).length, 0);
  console.log(`songs: ${rows.length}; with any feeling: ${rows.filter((r) => Object.keys(r.families).length).length}`);
  console.log(`feeling labels: high ${count("high")}, medium ${count("medium")}, low ${count("low")}, flagged ${count("flagged")}`);
  for (const f of FAMILIES) console.log(`  ${f}: ${rows.filter((r) => r.families[f] && r.families[f] !== "flagged").length} songs (+${rows.filter((r) => r.families[f] === "flagged").length} flagged)`);
  console.log(`energy flagged ${rows.filter((r) => r.energy_conf === "flagged").length}; vocals flagged ${rows.filter((r) => r.vocals_conf === "flagged").length}; check list ${check.length}`);
}

if (process.argv[1]?.endsWith("merge-labels.ts")) main().catch((e) => { console.error(e); process.exit(1); });
