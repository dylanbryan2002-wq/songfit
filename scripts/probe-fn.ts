import { createServiceClient } from "../src/db/client";
async function main() {
  const db = createServiceClient();
  const { data, error } = await db.rpc("exec_sql", { sql: "select 1" });
  console.log("exec_sql ok:", !error);
  const r = await db.from("submissions").select("id", { count: "exact", head: true });
  console.log("submissions reachable:", !r.error);
}
main().catch((e) => { console.error(e); process.exit(1); });
