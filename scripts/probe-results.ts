/* Reproduce what app/results/[id]/page.tsx does on a ready submission: pnpm local scripts/probe-results.ts <id> */
import { getSubmission, markSubmissionViewed } from "../src/db/queries/submissions";
import { listRecommendations } from "../src/db/queries/recommendations";
import { toRecommendationView } from "../src/feedback/recommendationView";
import { logEvent } from "../src/feedback/events";

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try { const v = await fn(); console.log(`OK   ${name}`); return v; }
  catch (e) { console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`); return undefined; }
}
async function main() {
  const id = process.argv[2]!;
  const sub = await step("getSubmission", () => getSubmission(id));
  console.log(`status=${sub?.status} viewed_at=${sub?.viewed_at}`);
  const rows = await step("listRecommendations", () => listRecommendations(id));
  console.log(`rows=${rows?.length}`);
  for (const r of rows ?? []) await step(`toRecommendationView #${r.rank}`, async () => toRecommendationView(r));
  const marked = await step("markSubmissionViewed", () => markSubmissionViewed(id));
  console.log(`marked=${marked}`);
  await step("logEvent recommendations_viewed", () => logEvent({ name: "recommendations_viewed", creatorId: sub!.creator_id, submissionId: id }));
}
main().catch((e) => { console.error(e); process.exit(1); });
