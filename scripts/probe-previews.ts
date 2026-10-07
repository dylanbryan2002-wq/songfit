import { listRecommendations } from "../src/db/queries/recommendations";
import { listCandidates } from "../src/db/queries/candidates";
async function main() {
  const id = process.argv[2]!;
  for (const r of await listRecommendations(id)) console.log(`#${r.rank} ${r.title} preview=${r.preview_url ?? "-"} art=${r.artwork_url ? "yes" : "-"} deezer=${r.deezer_url ?? "-"}`);
  const c = await listCandidates(id);
  const v = c.filter((x) => x.verified);
  console.log(`candidates verified=${v.length} withPreview=${v.filter((x) => x.preview_url).length} withArt=${v.filter((x) => x.artwork_url).length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
