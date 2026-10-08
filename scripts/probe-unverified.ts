import { listCandidates } from "../src/db/queries/candidates";
async function main() {
  for (const id of process.argv.slice(2)) {
    const rows = await listCandidates(id);
    const un = rows.filter((r) => !r.verified);
    console.log(`== ${id}: ${rows.length} candidates, ${un.length} unverified`);
    for (const r of un) console.log(`${r.title} ||| ${r.artist}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
