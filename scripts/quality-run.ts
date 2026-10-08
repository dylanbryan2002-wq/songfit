/* Recommend-stage dry run for prompt tuning: pnpm local scripts/quality-run.ts <submission-id> <tag>
   Runs generate → verify → score → diversify → sections → explain against a stored analysis with every
   database write stubbed (nothing persisted) and writes .superpowers/sdd/2026-10-06-songfit-mvp/quality-run-<id>-<tag>.md */
import { writeFileSync } from "node:fs";
import { recommendSubmission } from "../src/engine/recommend";
import { generateCandidates } from "../src/engine/candidates/generateCandidates";
import { verifyCandidates } from "../src/engine/catalog/verifyCandidates";
import { scoreCandidates } from "../src/engine/scoring/scoreCandidates";
import { diversify } from "../src/engine/diversify/diversify";
import { selectSections } from "../src/engine/sections/selectSections";
import { explainPicks } from "../src/engine/explain/explainPicks";
import { getAnalysis } from "../src/db/queries/analyses";
import { getSubmission } from "../src/db/queries/submissions";
import { listNotFoundSongs } from "../src/db/queries/notFound";

const id = process.argv[2] ?? "";
const tag = process.argv[3];
if (!id || !tag) { console.error("usage: pnpm local scripts/quality-run.ts <submission-id> <tag>"); process.exit(1); }
const mmss = (s: number | null | undefined) => s == null ? "-" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const out: string[] = [];
const p = (s = "") => out.push(s);
async function main() {
  const t0 = Date.now();
  const stored = await getAnalysis(id);
  if (!stored) throw new Error("no analysis");
  p(`# Quality run ${id}`); p(); p(`Run at ${new Date().toISOString()}, recommend stage dry run (DB writes stubbed).`); p();
  p("## VideoAnalysis"); p("```json"); p(JSON.stringify(stored.analysis, null, 2)); p("```"); p();
  p("## MusicBrief"); p(stored.brief.text); p(); p("```json"); p(JSON.stringify(stored.brief.fields, null, 2)); p("```"); p();
  let cands: any[] = []; let finals: any[] = []; let gens: any[] = []; let generateCalls = 0;
  await recommendSubmission(id, { deadlineAt: Date.now() + 400_000 } as any, {
    getSubmission, getAnalysis, listNotFound: listNotFoundSongs,
    generate: async (b, a, o) => { generateCalls += 1; const g = await generateCandidates(b, a, o); gens.push(...g); return g; },
    verify: verifyCandidates, score: scoreCandidates, diversify, sections: selectSections,
    explain: async (picks, a, b, d) => { finals = await explainPicks(picks, a, b, d); return finals; },
    replaceCandidates: async (_s, rows) => { cands = rows; return rows.map((r, i) => ({ ...r, id: `cand-${i}` })) as never; },
    replaceRecommendations: async () => [] as never,
    setStatus: async () => {}, logEvent: async () => {},
  });
  p(`## Candidates (${cands.length}; ${cands.filter((c) => c.verified).length} verified) — sorted by total`);
  p(); p("| # | title — artist | dirs | total | sem | emo | aes | pace | dial | cult | orig | window (anchor) | vocal | fit_reason |"); p("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const sorted = [...cands].sort((a, b) => (b.total_score ?? -1) - (a.total_score ?? -1));
  sorted.forEach((c, i) => {
    const cs = c.component_scores ?? {};
    const g = (k: string) => cs[k] ? cs[k].score.toFixed(2) : "-";
    p(`| ${i + 1} | ${c.verified ? "" : "UNVERIFIED "}${c.canonical_title ?? c.title} — ${c.canonical_artist ?? c.artist} | ${c.directions.join(",")} | ${c.total_score?.toFixed(3) ?? "-"} | ${g("semantic")} | ${g("emotional")} | ${g("aesthetic")} | ${g("pacing")} | ${g("dialogue")} | ${g("cultural")} | ${g("originality")} | ${mmss(c.proposed_start)}–${mmss(c.proposed_end)} (${mmss(c.anchor_seconds)}) dur ${mmss(c.duration_seconds)} | ${c.section_is_vocal} | ${String(c.fit_reason).replace(/\|/g, "/")} |`);
  });
  p(); p("### Component-score reasons (verified, top 20)");
  for (const c of sorted.filter((c) => c.verified).slice(0, 20)) {
    p(`- **${c.canonical_title} — ${c.canonical_artist}** (${c.total_score?.toFixed(3)}): section_reason: ${c.section_reason}`);
    for (const [k, v] of Object.entries(c.component_scores ?? {})) p(`  - ${k} ${(v as any).score.toFixed(2)}: ${(v as any).reason}`);
  }
  p(); p("## The 15 picks");
  for (const f of finals) {
    p(); p(`### ${f.rank}. ${f.canonical_title} — ${f.canonical_artist} [${f.direction_label}] dirs=${f.directions.join(",")}`);
    p(`- section: ${mmss(f.start_seconds)}–${mmss(f.end_seconds)} (model proposed ${mmss(f.proposed_start)}–${mmss(f.proposed_end)}, anchor ${mmss(f.anchor_seconds)}, song dur ${mmss(f.duration_seconds)}), aligned_to_moment=${f.aligned_to_moment}`);
    p(`- total ${f.total_score.toFixed(3)}; section_reason: ${f.section_reason}`);
    p(`- explanation: ${f.explanation}`);
  }
  p(); p(`Generate calls: ${generateCalls} (2 = regenerate fired). Elapsed ${Math.round((Date.now() - t0) / 1000)} s.`);
  const path = `.superpowers/sdd/2026-10-06-songfit-mvp/quality-run-${id}-${tag}.md`;
  writeFileSync(path, out.join("\n") + "\n");
  console.log(`wrote ${path}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
