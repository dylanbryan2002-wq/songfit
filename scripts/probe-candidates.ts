/* Measure one candidate-generation call: pnpm local scripts/probe-candidates.ts <submission-id> [direction] */
import { getAnalysis } from "../src/db/queries/analyses";
import { buildCandidatePrompt, SYSTEM_PROMPT } from "../src/engine/candidates/generateCandidates";
import { callClaude } from "../src/shared/anthropic";
import { MODELS } from "../src/shared/config";
import type { DirectionTag } from "../src/shared/types";

async function main() {
  const id = process.argv[2]!;
  const direction = (process.argv[3] ?? "safe") as DirectionTag;
  const effort = process.argv[4] as "low" | "medium" | "high" | undefined;
  const a = await getAnalysis(id);
  if (!a) throw new Error("no analysis");
  const user = buildCandidatePrompt(direction, a.brief, a.analysis);
  const text = await callClaude({ model: MODELS.candidates, system: SYSTEM_PROMPT, user, maxTokens: 12000, effort });
  console.log(`chars=${text.length} approxTokens=${Math.round(text.length / 4)}`);
  console.log(text.slice(0, 1400));
}
main().catch((e) => { console.error(e); process.exit(1); });
