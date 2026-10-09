/* Delete one creator on request: their videos (also those under the anonymous folder they claimed
   runs from), the event rows that survive the cascade, the anonymous auth users those runs came from,
   then their auth user (cascade: creators → submissions → analyses, candidates, recommendations,
   subscriptions). Dry run unless --yes.
   Usage: pnpm local scripts/delete-creator.ts <email> [--yes]  (docs/RUNBOOK.md → Deletion on request) */
import { createServiceClient } from "../src/db/client";
import { deleteAuthUser, deleteEvents, parseArgs, planCleanup, removeObjects } from "./lib/creatorCleanup";

async function main() {
  const { positional, yes } = parseArgs(process.argv.slice(2));
  const email = positional[0]?.trim();
  if (!email) {
    console.error("usage: pnpm local scripts/delete-creator.ts <email> [--yes]");
    process.exit(1);
  }
  const supabase = createServiceClient();
  // Exact match first (stored as Google sent it), then lower-cased.
  let { data: creator, error } = await supabase.from("creators").select("id, email").eq("email", email).maybeSingle();
  if (!error && !creator) {
    ({ data: creator, error } = await supabase.from("creators").select("id, email").eq("email", email.toLowerCase()).maybeSingle());
  }
  if (error) throw new Error(`creator lookup: ${error.message}`);
  if (!creator) {
    console.error(`no creator with email ${email}`);
    process.exit(1);
  }

  const plan = await planCleanup(supabase, [creator.id]);
  // Anonymous ids the claimed runs came from (their folder ≠ the creator's id). Only rows with no email.
  const anonCandidates = plan.folders.filter((f) => f !== creator.id);
  const { data: anonRows, error: anonErr } = anonCandidates.length
    ? await supabase.from("creators").select("id").in("id", anonCandidates).is("email", null)
    : { data: [], error: null };
  if (anonErr) throw new Error(`anonymous lookup: ${anonErr.message}`);
  const anonIds = (anonRows ?? []).map((r) => r.id);

  console.log(`creator ${creator.id} <${creator.email}>`);
  console.log(`submissions: ${plan.submissionIds.length}`);
  console.log(`folders: ${plan.folders.join(", ") || "-"}`);
  console.log(`storage objects to delete (${plan.paths.length}):`);
  for (const p of plan.paths) console.log(`  ${p}`);
  if (plan.keptForOthers.length) console.log(`kept, used by another creator's run: ${plan.keptForOthers.join(", ")}`);
  console.log(`anonymous auth users to delete: ${anonIds.join(", ") || "-"}`);

  if (!yes) {
    console.log("\nDRY RUN. Nothing deleted. Re-run with --yes to delete.");
    return;
  }

  await removeObjects(supabase, plan.paths);
  console.log(`deleted ${plan.paths.length} storage objects`);
  const events = await deleteEvents(supabase, [creator.id, ...anonIds], plan.submissionIds);
  console.log(`deleted ${events} event rows`);
  for (const id of anonIds) {
    await deleteAuthUser(supabase, id);
    console.log(`deleted anonymous auth user ${id}`);
  }
  await deleteAuthUser(supabase, creator.id);
  console.log(`deleted auth user ${creator.id}; creators, submissions, analyses, candidates, recommendations, subscriptions cascaded`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
