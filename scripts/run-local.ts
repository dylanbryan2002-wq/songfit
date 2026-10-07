/* Run the full pipeline for one submission from this machine, against the hosted
   Supabase project, with full logs in the terminal.
   Usage: pnpm pipeline:local <submission-id>  (env loaded by the package.json script) */
import { getSubmission } from "../src/db/queries/submissions";
import { listRecommendations } from "../src/db/queries/recommendations";
import { runSubmission } from "../src/pipeline/run";

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: pnpm pipeline:local <submission-id>");
    process.exit(1);
  }

  const before = await getSubmission(id);
  if (!before) {
    console.error(`no submission ${id}`);
    process.exit(1);
  }
  console.log(`before: status=${before.status} error=${before.error ?? "-"}`);

  const t0 = Date.now();
  await runSubmission(id);
  const after = await getSubmission(id);
  console.log(`after:  status=${after?.status} error=${after?.error ?? "-"} elapsed=${Math.round((Date.now() - t0) / 1000)}s`);

  if (after?.status === "ready") {
    for (const r of await listRecommendations(id)) {
      console.log(`#${r.rank} [${r.direction_label}] ${r.title} — ${r.artist}  ${r.start_seconds}–${r.end_seconds}s aligned=${r.aligned_to_moment ?? "-"}`);
      console.log(`   ${r.explanation}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
