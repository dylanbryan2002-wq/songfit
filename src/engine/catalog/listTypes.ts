import type { MusicBrief, VideoAnalysis } from "@/src/shared/types";
import type { ListType } from "@/src/engine/catalog/creatorLists";

// Which creator-list video types a clip belongs to (docs/review/24, v3 §5). Pure rules over fields the analysis
// already produces; may return []. Checked against 30 blind-labelled tune clips on 2026-10-09
// (scripts/groundtruth/list-types-check.ts). Types whose rules missed the precision bar, or had fewer than
// 5 predicted positives, are inactive: sad, upbeat, funny, day_in_life.
export const ACTIVE_LIST_TYPES: readonly ListType[] = ["educational", "storytelling", "emotional", "motivational"];

const EDU_FORMAT = ["tutorial", "explainer", "educational", "how-to", "protocol", "commentary", "interview", "breakdown", "showcase", "demo"];
const EDU_MOOD = ["informative", "instructive", "explanatory"];
const STORY_FORMAT = ["storytelling", "story", "storytime", "story time", "journey", "essay", "retrospective", "tribute", "narrative", "confessional"];
const FUNNY_MOOD = ["humorous", "funny", "comedic", "silly", "sarcastic", "quirky"];
const EMOTIONAL_MOOD = ["bittersweet", "nostalgic", "heartfelt", "tender", "vulnerable", "wistful", "sentimental", "confessional", "melancholic"];
const MOTIVATIONAL_MOOD = ["motivational", "inspiring", "uplifting", "triumphant"];

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word (or whole-phrase) match, case-insensitive. */
const hasWord = (text: string, words: string[]) => words.some((w) => new RegExp(`(^|[^a-z0-9])${esc(w)}($|[^a-z0-9])`, "i").test(text));
/** Mood tags are short phrases: exact match after lower-casing, so "lightly comedic" is not "comedic". */
const tags = (analysis: VideoAnalysis, brief: MusicBrief) => new Set([...analysis.mood, ...brief.fields.moods].map((m) => m.toLowerCase().trim()));
const count = (set: Set<string>, words: string[]) => words.filter((w) => set.has(w)).length;

export function listTypesFor(analysis: VideoAnalysis, brief: MusicBrief): ListType[] {
  const moods = tags(analysis, brief);
  const funny = analysis.content_category === "comedy" || count(moods, FUNNY_MOOD) > 0;
  const educational = hasWord(analysis.content_type, EDU_FORMAT) || count(moods, EDU_MOOD) > 0;
  const out: ListType[] = [];
  if (educational) out.push("educational");
  if (!educational && !funny && hasWord(analysis.content_type, STORY_FORMAT)) out.push("storytelling");
  if (count(moods, EMOTIONAL_MOOD) >= 2 && (analysis.energy === "low" || analysis.energy === "medium")) out.push("emotional");
  if (!educational && count(moods, MOTIVATIONAL_MOOD) > 0) out.push("motivational");
  return out.filter((t) => ACTIVE_LIST_TYPES.includes(t));
}
