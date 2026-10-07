import { getSubmission } from "../src/db/queries/submissions";
import { createServiceClient } from "../src/db/client";
async function main() {
  const id = process.argv[2]!;
  const sub = await getSubmission(id);
  const db = createServiceClient();
  const { data: creators } = await db.from("creators").select("id,email,created_at").order("created_at");
  console.log("submission.creator_id =", sub?.creator_id, "status =", sub?.status);
  for (const c of creators ?? []) console.log(`creator ${c.id} ${c.email} ${c.created_at}${c.id === sub?.creator_id ? "  <-- owner" : ""}`);
  const { data: subs } = await db.from("submissions").select("id,creator_id,status,created_at").order("created_at", { ascending: false }).limit(8);
  for (const s of subs ?? []) console.log(`submission ${s.id} ${s.status} ${s.created_at} creator=${s.creator_id}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
