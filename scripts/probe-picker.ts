import { loadPicker } from "../src/feedback/picker";
async function main() {
  const data = await loadPicker(process.argv[2]!);
  console.log(`video_duration=${data.video_duration_seconds} rows=${data.rows.length}`);
  for (const r of data.rows) console.log(`#${r.rank} ${r.title} — ${r.artist} deezer_id=${r.deezer_id} preview=${r.preview_url ? r.preview_url.slice(0, 60) + "…" : "null"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
