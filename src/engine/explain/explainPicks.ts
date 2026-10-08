import { z } from "zod";
import { DIMENSIONS, type FinalRecommendation, type MusicBrief, type Pick, type VideoAnalysis } from "@/src/shared/types";
import { MODELS, PICKS_PER_BATCH } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { remainingBudget, type StageCtx } from "@/src/pipeline/budget";

export const PROMPT_VERSION = "explain-v3";

const SYSTEM = `You write the two-sentence reasons under Songfit's song picks. Voice: a sharp friend who edits
video. Second person. Exactly two sentences each. No hype, no emojis, no exclamation marks,
no words like "perfect", "vibe", "elevate".
Each reason must reference something specific in the video and say what the song section does for it.
This text is shown to creators: never mention scores, numbers, model names, AI, or how the pick was made,
and use no jargon.
Never claim a song is trending, viral, popular right now, or available on any platform.
Mention the song's moment landing on a video moment ONLY for picks marked "aligned: the song's moment lands at …"
(for example "the chorus lands around your reveal at 0:08"). For picks marked "aligned: no", say nothing about timing alignment.
The person on camera is almost always the creator: address them as "you" throughout, never "the man", "a guy", "him" or "her". At most ONE pick in this batch may mention timing, even if several are marked aligned; phrase it as "around 0:02", never "right on". Never say a specific lyric, hook or vocal is heard unless the Section note names it and you are sure it falls inside the window; if the Section note says "approximate", describe the feel, not the moment. Each reason is at most 40 words. Do not start two reasons in this batch with the same words. Never contradict the video's pacing or energy.`;

const Item = z.object({ rank: z.number().int(), explanation: z.string().min(1) });

const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function topReasons(p: Pick): string {
  return DIMENSIONS
    .map((d) => p.component_scores[d])
    .filter((s): s is NonNullable<typeof s> => !!s && !!s.reason)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.reason)
    .join("; ");
}

export function buildExplainPrompt(picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief): string {
  const list = picks
    .map((p) => `#${p.rank} (${p.direction_label}): "${p.canonical_title}" — ${p.canonical_artist}, use ${fmt(p.start_seconds)}–${fmt(p.end_seconds)}; aligned: ${p.aligned_to_moment === null ? "no" : `the song's moment lands at ${fmt(p.aligned_to_moment)} of the video`}.
   Section: ${p.section_reason}. Why proposed: ${p.fit_reason}. Strongest reasons: ${topReasons(p) || "n/a"}.`)
    .join("\n");
  return `VIDEO: ${analysis.summary}
Key moments: ${analysis.important_moments.map((m) => `${fmt(m.time)} ${m.type}`).join("; ") || "none"}
BRIEF: ${brief.text}

PICKS
${list}

Return ONLY a JSON array for these ${picks.length} picks, one item per rank: [{ "rank": ${picks[0]?.rank ?? 1}, "explanation": "..." }, ...]`;
}

export function spotifySearchUrl(title: string, artist: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`)}`;
}

export function parseExplanations(
  text: string, ranks: number[],
): { ok: true; byRank: Map<number, string> } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "no JSON found" };
  }
  const arr = z.array(Item).safeParse(raw);
  if (!arr.success) return { ok: false, error: arr.error.message };
  const byRank = new Map(arr.data.map((i) => [i.rank, i.explanation.trim()]));
  for (const r of ranks) if (!byRank.get(r)) return { ok: false, error: `missing rank ${r}` };
  return { ok: true, byRank };
}

/** One model call (plus one retry) for up to PICKS_PER_BATCH picks. */
async function explainBatch(
  picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief, call: ClaudeCall, ctx?: StageCtx,
): Promise<Map<number, string>> {
  const ranks = picks.map((p) => p.rank);
  const user = buildExplainPrompt(picks, analysis, brief);
  const timeoutMs = () => remainingBudget(ctx);

  // Low effort and a 3000-token cap: hidden reasoning counts against max_tokens, and a truncation fails the stage.
  const first = await call({ model: MODELS.explain, system: SYSTEM, user, maxTokens: 3000, effort: "low", timeoutMs: timeoutMs() });
  let parsed = parseExplanations(first, ranks);
  if (!parsed.ok) {
    logger.warn("explain.retry", { ranks, error: parsed.error.slice(0, 300) });
    const second = await call({
      model: MODELS.explain, system: SYSTEM,
      user: `${user}\n\nPREVIOUS OUTPUT WAS INVALID. Validation error:\n${parsed.error.slice(0, 1000)}\nReturn the full corrected JSON array.`,
      maxTokens: 3000, effort: "low", timeoutMs: timeoutMs(),
    });
    parsed = parseExplanations(second, ranks);
    if (!parsed.ok) throw new PipelineError("recommend", `explanation output invalid: ${parsed.error.slice(0, 200)}`, second);
  }
  return parsed.byRank;
}

export async function explainPicks(
  picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief,
  deps: { call?: ClaudeCall; ctx?: StageCtx } = {},
): Promise<FinalRecommendation[]> {
  const call = deps.call ?? callClaude;
  const batches: Pick[][] = [];
  for (let i = 0; i < picks.length; i += PICKS_PER_BATCH) batches.push(picks.slice(i, i + PICKS_PER_BATCH));

  const started = Date.now();
  const maps = await Promise.all(batches.map((b) => explainBatch(b, analysis, brief, call, deps.ctx)));
  logger.info("explain", { ms: Date.now() - started, calls: batches.length, promptVersion: PROMPT_VERSION });

  // preview_url (always a Deezer sample) and itunes_id (always null) come from verification as-is.
  const byRank = new Map(maps.flatMap((m) => [...m]));
  return picks.map((p) => ({
    ...p,
    explanation: byRank.get(p.rank)!,
    spotify_url: spotifySearchUrl(p.canonical_title, p.canonical_artist),
  }));
}
