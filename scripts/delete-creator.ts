/* Delete one creator on request: their videos (also those under the anonymous folder they claimed
   runs from), the event rows that survive the cascade, the anonymous auth users those runs came from
   (only once such a user has no submission and no object left), then their auth user (cascade:
   creators → submissions → analyses, candidates, recommendations, subscriptions). Dry run unless --yes.
   Usage: pnpm local scripts/delete-creator.ts <email> [--yes]  (docs/RUNBOOK.md → Deletion on request) */
import { createServiceClient } from "../src/db/client";
import { deleteCreators, parseArgs, planCleanup } from "./lib/creatorCleanup";

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
  // Folders other than the creator's own: possibly the anonymous ids claimed runs came from. A folder
  // proves nothing: deleteCreators deletes such a user only if it is anonymous with nothing left.
  const anonCandidates = plan.folders.filter((f) => f !== creator.id);

  console.log(`creator ${creator.id} <${creator.email}>`);
  console.log(`submissions: ${plan.submissionIds.length}`);
  console.log(`folders: ${plan.folders.join(", ") || "-"}`);
  console.log(`storage objects to delete (${plan.paths.length}):`);
  for (const p of plan.paths) console.log(`  ${p}`);
  if (plan.keptForOthers.length) console.log(`kept, used by another run: ${plan.keptForOthers.join(", ")}`);
  console.log(`anonymous auth users to check and delete: ${anonCandidates.join(", ") || "-"}`);

  if (!yes) {
    console.log("\nDRY RUN. Nothing deleted. Re-run with --yes to delete.");
    return;
  }

  // Throws at the first failure; nothing is reported as deleted until every step succeeded.
  const done = await deleteCreators(supabase, plan, { creatorIds: [creator.id], anonymousIds: anonCandidates });
  console.log(`deleted ${done.objects} storage objects, ${done.events} event rows`);
  console.log(`deleted anonymous auth users: ${done.anonymousDeleted.join(", ") || "-"}`);
  if (done.anonymousKept.length) console.log(`kept (not anonymous, or runs/files left): ${done.anonymousKept.join(", ")}`);
  console.log(`deleted auth user ${creator.id}; creators, submissions, analyses, candidates, recommendations, subscriptions cascaded`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
