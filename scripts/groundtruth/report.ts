/* Report: one summary table, then one section per clip. Markdown for reading, JSON for the next round to diff. */
import { STAGES, type BriefDiff, type Stage, type Truth, type Verdict } from "./compare";
import type { GeminiReply } from "./gemini";
import type { OursResult } from "./ours";

export type ClipReport = {
  id: string;
  file: string;
  link: string;
  niche: string;
  notes: string;
  truth: Truth | null; // null when clips.csv has no song for this clip: brief comparison only
  duration_seconds: number | null;
  verdict: Verdict | null; // null when our engine did not run
  ours: OursResult | null;
  gemini: GeminiReply | null; // null until Dylan pastes the reply into <root>/gemini/<id>.md
  brief_diff: BriefDiff | null;
  errors: string[];
};

export type RunMeta = { tag: string; date: string; gemini_prompt_version: string };

export type Summary = {
  clips: number;
  compared: number; // clips with a verdict
  without_truth: number; // clips with no known song (brief comparison only)
  hits: number;
  artist_hits: number;
  misses: number;
  errors: number;
  hit_rate: number | null;
  artist_hit_rate: number | null;
  median_section_error_seconds: number | null;
  median_hit_rank: number | null;
  misses_by_stage: Record<Stage, number>;
};

export type ReportJson = RunMeta & { summary: Summary; clips: ClipReport[] };

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function summarize(clips: ClipReport[]): Summary {
  const verdicts = clips.flatMap((c) => (c.verdict ? [c.verdict] : []));
  const hits = verdicts.filter((v) => v.result === "hit");
  const misses_by_stage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const v of verdicts) if (v.lost_at) misses_by_stage[v.lost_at] += 1;
  const n = verdicts.length;
  return {
    clips: clips.length, compared: n, without_truth: clips.filter((c) => !c.truth).length, hits: hits.length,
    artist_hits: verdicts.filter((v) => v.result === "artist_hit").length,
    misses: verdicts.filter((v) => v.result === "miss").length,
    errors: clips.filter((c) => c.errors.length > 0).length,
    hit_rate: n ? hits.length / n : null,
    artist_hit_rate: n ? verdicts.filter((v) => v.result === "artist_hit").length / n : null,
    median_section_error_seconds: median(hits.map((v) => v.section_error_seconds!)),
    median_hit_rank: median(hits.map((v) => v.rank!)),
    misses_by_stage,
  };
}

const mmss = (s: number | null | undefined) => (s == null ? "-" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
const pct = (x: number | null) => (x == null ? "-" : `${Math.round(x * 100)}%`);
const cell = (s: string | null | undefined) => (s ?? "-").replace(/\|/g, "/").replace(/\n+/g, " ");
const list = (xs: string[] | undefined) => (xs && xs.length ? xs.join(", ") : "-");

export function summaryTable(s: Summary): string {
  const stages = STAGES.filter((st) => s.misses_by_stage[st] > 0).map((st) => `${st} ${s.misses_by_stage[st]}`);
  return [
    "| Metric | Value |", "|---|---|",
    `| Clips | ${s.clips} |`,
    `| Compared (our engine ran) | ${s.compared} |`,
    `| No known song (brief comparison only) | ${s.without_truth} |`,
    `| Hit rate | ${s.hits}/${s.compared} (${pct(s.hit_rate)}) |`,
    `| Artist-hit rate | ${s.artist_hits}/${s.compared} (${pct(s.artist_hit_rate)}) |`,
    `| Misses | ${s.misses} |`,
    `| Median section error | ${s.median_section_error_seconds == null ? "-" : `${s.median_section_error_seconds.toFixed(1)} s`} |`,
    `| Median rank on hits | ${s.median_hit_rank ?? "-"} |`,
    `| Misses by stage | ${stages.length ? stages.join(", ") : "-"} |`,
    `| Clips with errors | ${s.errors} |`,
  ].join("\n");
}

function verdictLine(v: Verdict | null, truth: Truth): string {
  if (!v) return "not compared (our engine did not run)";
  if (v.result === "hit") return `HIT at rank ${v.rank}: we said ${mmss(v.our_start_seconds)}, real ${mmss(truth.start_seconds)}; section error ${v.section_error_seconds!.toFixed(1)} s`;
  const where = `lost at **${v.lost_at}**`;
  return v.result === "artist_hit" ? `ARTIST HIT (${v.matched!.title} — ${v.matched!.artist}); the real song was ${where}` : `MISS, ${where}`;
}

function clipSection(c: ClipReport): string[] {
  const out: string[] = [];
  const p = (s = "") => out.push(s);
  const g = c.gemini?.parsed ?? null;
  p(`## ${c.id}`); p();
  p(`- file: ${c.file}${c.link ? ` · ${c.link}` : ""}${c.niche ? ` · niche: ${c.niche}` : ""} · duration ${c.duration_seconds?.toFixed(1) ?? "-"} s`);
  if (c.truth) p(`- real song: **${c.truth.song} — ${c.truth.artist}**, starts at ${mmss(c.truth.start_seconds)} (${c.truth.start_seconds} s)`);
  else p("- real song: unknown (no song in clips.csv), brief comparison only");
  if (c.notes) p(`- notes: ${c.notes}`);
  p(`- verdict: ${c.truth ? verdictLine(c.verdict, c.truth) : "no hit verdict without a known song"}`);
  for (const e of c.errors) p(`- error: ${e}`);
  if (c.ours) {
    p(); p(`### Our top 5 (of ${c.ours.finals.length}; ${c.ours.candidates.length} candidates, ${c.ours.candidates.filter((x) => x.verified).length} verified, ${c.ours.generate_calls} generate calls)`); p();
    p("| # | song | section | label | why |"); p("|---|---|---|---|---|");
    for (const f of [...c.ours.finals].sort((a, b) => a.rank - b.rank).slice(0, 5)) {
      p(`| ${f.rank} | ${cell(f.canonical_title)} — ${cell(f.canonical_artist)} | ${mmss(f.start_seconds)}–${mmss(f.end_seconds)} | ${f.direction_label} | ${cell(f.explanation)} |`);
    }
    if (c.ours.recommend_error) p(`- recommend stage error: ${c.ours.recommend_error}`);
  }
  p(); p("### Gemini on the music"); p();
  if (!g) p("no Gemini analysis yet");
  else {
    p(`- song as Gemini heard it (not trusted): ${g.song.title ?? "unknown"} — ${g.song.artist ?? "unknown"} (${g.song.confidence} confidence)`);
    p(`- section start in song: ${g.music.section_start_seconds_in_song == null ? "unknown" : `${mmss(g.music.section_start_seconds_in_song)} (${g.music.section_start_seconds_in_song} s)`}`);
    p(`- role: ${g.music.role} — ${g.music.role_note}`);
    p(`- why it works: ${g.music.why_it_works}`);
    for (const h of g.music.hits) p(`- ${h.video_time}s: ${h.what_music_does}`);
  }
  p(); p("### Briefs side by side"); p();
  const ours = c.ours ? { analysis: c.ours.analysis, brief: c.ours.brief } : null;
  p("| | Ours (muted) | Gemini (with sound) |"); p("|---|---|---|");
  const row = (label: string, a: string | null | undefined, b: string | null | undefined) => p(`| ${label} | ${cell(a)} | ${cell(b)} |`);
  row("summary", ours?.analysis.summary, g?.summary);
  row("category", ours?.analysis.content_category, g?.content_category);
  row("setting / story", ours && `${ours.analysis.setting ?? "-"} / ${ours.analysis.story ?? "-"}`, g && `${g.setting ?? "-"} / ${g.story ?? "-"}`);
  row("energy / pacing", ours && `${ours.analysis.energy} / ${ours.analysis.pacing}`, g && `${g.energy} / ${g.pacing}`);
  row("mood", ours && list(ours.analysis.mood), g && list(g.mood));
  row("aesthetic", ours && list(ours.analysis.aesthetic), g && list(g.aesthetic));
  row("dialogue", ours && String(ours.analysis.dialogue_present), g && String(g.dialogue_present));
  row("key moments", ours && list(ours.analysis.important_moments.map((m) => `${m.time}s ${m.type}`)), g && list(g.key_moments.map((m) => `${m.time}s ${m.type}${m.note ? ` (${m.note})` : ""}`)));
  row("brief", ours?.brief.text, g?.brief.text);
  row("brief fields",
    ours && `energy ${ours.brief.fields.energy}, tempo ${ours.brief.fields.tempo_preference}, vocals ${ours.brief.fields.vocal_preference}, moods ${list(ours.brief.fields.moods)}, genres ${list(ours.brief.fields.genre_preferences)}, familiarity ${ours.brief.fields.desired_familiarity}`,
    g && `energy ${g.brief.energy}, tempo ${g.brief.tempo}, vocals ${g.brief.vocals}, moods ${list(g.brief.moods)}, genres ${list(g.brief.genres)}, familiarity ${g.brief.familiarity}`);
  p();
  return out;
}

export function buildReport(meta: RunMeta, clips: ClipReport[]): { json: ReportJson; markdown: string } {
  const summary = summarize(clips);
  const lines = [
    `# Ground-truth eval ${meta.date} — ${meta.tag}`, "",
    `Our engine (muted clips) vs the real song, with Gemini (prompt ${meta.gemini_prompt_version}, pasted from the app) as a second watcher. Nothing here is persisted.`, "",
    summaryTable(summary), "",
    ...clips.flatMap(clipSection),
  ];
  return { json: { ...meta, summary, clips }, markdown: lines.join("\n") };
}
