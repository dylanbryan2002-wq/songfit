// ASSUMPTION (replace when we have real audio-structure analysis):
// anchor_seconds is the generator's claim of where the song's defining moment is (unverified).
// The creator starts the song at video time 0, so to land the hit on video time T the section
// must start at (anchor - T). We only claim alignment when that is feasible; otherwise the window is
// kept as fitted and aligned_to_moment is null. We never clamp to 0 and call it aligned.
import type { Pick, VideoAnalysis } from "@/src/shared/types";
import { LIMITS } from "@/src/shared/config";

const KEY_MOMENT_TYPES = new Set(["main_visual_reveal", "climax", "transition"]);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Length in [sectionMin, sectionMax] (end moves only), capped at track end, containing the anchor. */
export function fitWindow(start: number, end: number, anchor: number, duration: number): { start: number; end: number } {
  let s = Math.max(0, start);
  const len = Math.min(LIMITS.sectionMax, Math.max(LIMITS.sectionMin, end - s));
  let e = s + len;
  if (anchor < s || anchor > e) {
    s = Math.max(0, anchor - 2);
    e = s + len;
  }
  // Cap at the track end; if that leaves it shorter than sectionMin, keep it (short tracks were dropped upstream).
  if (duration > 0 && e > duration) e = duration;
  return { start: round1(s), end: round1(e) };
}

export function alignToMoment(
  window: { start: number; end: number }, anchor: number, duration: number, analysis: VideoAnalysis,
): { start: number; end: number; aligned_to_moment: number } | null {
  const moment = analysis.important_moments
    .filter((m) => KEY_MOMENT_TYPES.has(m.type))
    .reduce<{ time: number } | undefined>((best, m) => (!best || m.time < best.time ? m : best), undefined);
  if (!moment) return null;
  const len = window.end - window.start;
  const start = anchor - moment.time;
  if (start < 0) return null;
  if (duration > 0 && start + len > duration) return null;
  if (anchor < start || anchor > start + len) return null;
  return { start: round1(start), end: round1(start + len), aligned_to_moment: moment.time };
}

export function selectSections(picks: Pick[], analysis: VideoAnalysis): Pick[] {
  return picks.map((p) => {
    const fitted = fitWindow(p.start_seconds, p.end_seconds, p.anchor_seconds, p.duration_seconds);
    const aligned = alignToMoment(fitted, p.anchor_seconds, p.duration_seconds, analysis);
    return aligned
      ? { ...p, start_seconds: aligned.start, end_seconds: aligned.end, aligned_to_moment: aligned.aligned_to_moment }
      : { ...p, start_seconds: fitted.start, end_seconds: fitted.end, aligned_to_moment: null };
  });
}
