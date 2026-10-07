import { transcribe } from "../src/analysis/transcribe";
async function main() {
  for (const p of process.argv.slice(2)) {
    const t = await transcribe(p);
    console.log(`== ${p.split("/").pop()}`);
    for (const s of t.segments) console.log(`${s.start.toFixed(1)}-${s.end.toFixed(1)} ${s.text.trim()}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
