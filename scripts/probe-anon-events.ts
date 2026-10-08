import { createServiceClient } from "../src/db/client";
async function main() {
  const db = createServiceClient();
  const { data } = await db.from("events").select("id,name,created_at,metadata").is("creator_id", null).order("created_at", { ascending: false }).limit(50);
  for (const e of data ?? []) console.log(`${e.created_at} ${e.name} ${JSON.stringify(e.metadata ?? {})}`);
  console.log(`total anonymous events: ${data?.length ?? 0}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
