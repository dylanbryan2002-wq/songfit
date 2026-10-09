// What the engine learns from real Reels in our niche (docs/review/27 v3): a playbook of decision rules plus worked
// lessons, written by the study pass from the practice (tune) Reels and Gemini's write-ups, with the write-ups' music
// errors corrected and only confident lessons kept. Regenerate with scripts/groundtruth/study.ts then build-lessons.ts.
import { LESSONS_DATA } from "@/src/engine/candidates/creatorLessons.data";

export const LESSONS_VERSION = LESSONS_DATA.version;

/** The block appended to the candidates system prompt when lessons are on. Identical for every video. */
export function lessonsBlock(data: { playbook: readonly string[]; lessons: readonly { job: string; video: string; song: string; what_music_does: string; why_it_works: string; lazy_wrong_pick: string; rule: string }[] } = LESSONS_DATA): string {
  return [
    "HOW CREATORS IN THIS NICHE ACTUALLY CHOOSE. Learn the pattern, not the list: the songs below are evidence, not a menu;",
    "reuse one only if it truly fits this video. What matters is what the music DOES for the viewer.",
    "",
    "PLAYBOOK",
    ...data.playbook.map((r, i) => `${i + 1}. ${r}`),
    "",
    "WORKED EXAMPLES (real Reels; the song the creator used; what a generic pick would have done wrong)",
    ...data.lessons.map((l, i) => `${i + 1}. [${l.job}] ${l.video} Creator used: ${l.song}. What it does: ${l.what_music_does} Why: ${l.why_it_works} Generic pick that fails: ${l.lazy_wrong_pick} Rule: ${l.rule}`),
  ].join("\n");
}
