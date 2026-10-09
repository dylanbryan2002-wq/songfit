/* Monthly purge of unclaimed anonymous runs: every creator with `email is null` created more than
   30 days ago, with no submission in the last 30 days, loses its storage objects (except files a Google creator's claimed run still uses),
   its event rows and its auth user (cascade removes its creators row and submissions). Dry run unless --yes.
   Usage: pnpm local scripts/purge-anonymous.ts [--yes]  (docs/RUNBOOK.md → Deletion on request) */
import { createServiceClient } from "../src/db/client";
import { deleteAuthUser, deleteEvents, parseArgs, planCleanup, removeObjects } from "./lib/creatorCleanup";

const PURGE_AFTER_DAYS = 30;

async function main() {
  const { yes } = parseArgs(process.argv.slice(2));
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 3_600_000).toISOString();

  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("creators")
      .select("id")
      .is("email", null)
      .lt("created_at", cutoff)
      .order("created_at")
      .range(from, from + 999);
    if (error) throw new Error(`creators: ${error.message}`);
    ids.push(...(data ?? []).map((r) => r.id));
    if ((data ?? []).length < 1000) break;
  }
  console.log(`anonymous creators created before ${cutoff}: ${ids.length}`);
  if (ids.length === 0) return;

  let objects = 0;
  let events = 0;
  let purged = 0;
  for (let i = 0; i < ids.length; i += 50) {
    // An old anonymous session can still have a recent run: skip any creator with a submission since the cutoff.
    const { data: recent, error: recentErr } = await supabase
      .from("submissions")
      .select("creator_id")
      .in("creator_id", ids.slice(i, i + 50))
      .gte("created_at", cutoff);
    if (recentErr) throw new Error(`recent submissions: ${recentErr.message}`);
    const active = new Set((recent ?? []).map((r) => r.creator_id));
    const batch = ids.slice(i, i + 50).filter((id) => !active.has(id));
    if (active.size) console.log(`skipping ${active.size} with a run in the last ${PURGE_AFTER_DAYS} days`);
    if (batch.length === 0) continue;
    const plan = await planCleanup(supabase, batch);
    console.log(`batch ${i / 50 + 1}: ${batch.length} creators, ${plan.submissionIds.length} submissions, ${plan.paths.length} objects`);
    for (const p of plan.paths) console.log(`  ${p}`);
    if (plan.keptForOthers.length) console.log(`  kept (claimed by a Google creator): ${plan.keptForOthers.length}`);
    if (!yes) continue;
    await removeObjects(supabase, plan.paths);
    objects += plan.paths.length;
    events += await deleteEvents(supabase, batch, plan.submissionIds);
    for (const id of batch) await deleteAuthUser(supabase, id);
    purged += batch.length;
  }

  if (!yes) {
    console.log("\nDRY RUN. Nothing deleted. Re-run with --yes to delete.");
    return;
  }
  console.log(`deleted ${objects} storage objects, ${events} event rows, ${purged} anonymous auth users`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
