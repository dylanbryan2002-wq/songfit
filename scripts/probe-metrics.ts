import { getMetrics } from "../src/db/queries/metrics";
async function main() {
  const m = await getMetrics();
  console.log(JSON.stringify(m, null, 1).slice(0, 2500));
}
main().catch((e) => { console.error(e); process.exit(1); });
