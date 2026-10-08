import { createServiceClient } from "../src/db/client";
async function main() {
  const db = createServiceClient();
  const since = new Date(Date.now() - 40 * 60_000).toISOString();
  const { data: subs } = await db.from("submissions").select("id,creator_id,status,error,created_at,recommended_at,duration_seconds").gte("created_at", since).order("created_at", { ascending: false });
  for (const s of subs ?? []) console.log(`submission ${s.id} ${s.status} err=${s.error ?? "-"} created=${s.created_at} ready=${s.recommended_at ?? "-"} dur=${s.duration_seconds}`);
  const { data: ev } = await db.from("events").select("name,submission_id,created_at,metadata").gte("created_at", since).order("created_at", { ascending: false }).limit(30);
  for (const e of ev ?? []) console.log(`event ${e.created_at} ${e.name} ${e.submission_id ?? ""} ${JSON.stringify(e.metadata ?? {}).slice(0, 80)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
