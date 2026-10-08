import { DIMENSIONS, type ComponentScores } from "@/src/shared/types";
import type { CandidateRow } from "@/src/db/queries/candidates";
import { formatTime } from "@/src/shared/format";

export function CandidatesTable({ rows }: { rows: CandidateRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left">
            <th className="p-1">#</th><th className="p-1">Song</th><th className="p-1">Dirs</th><th className="p-1">Verified</th>
            <th className="p-1">Anchor</th><th className="p-1">Window</th><th className="p-1">Total</th>
            {DIMENSIONS.map((d) => <th key={d} className="p-1">{d.slice(0, 4)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const scores = r.component_scores as ComponentScores | null;
            return (
              <tr key={r.id} className={r.verified ? "" : "text-gray-400"}>
                <td className="p-1">{i + 1}</td>
                <td className="p-1" title={`${r.section_reason} / ${r.fit_reason}`}>{r.canonical_title ?? r.title} — {r.canonical_artist ?? r.artist}</td>
                {/* "current" is the model's belief about recent popularity, not a measured trend (I9). */}
                <td className="p-1">{(r.directions ?? []).map((d) => (d === "current" ? "current (unverified)" : d)).join(", ")}</td>
                {/* An unverified row with a deezer_id matched on Deezer but had no sample (samples-only rule). */}
                <td className="p-1">{r.verified ? "yes" : r.deezer_id ? "no sample" : "no"}</td>
                <td className="p-1">{formatTime(Number(r.anchor_seconds))}</td>
                <td className="p-1">{formatTime(Number(r.proposed_start))}–{formatTime(Number(r.proposed_end))}</td>
                <td className="p-1 font-mono">{r.total_score === null ? "—" : Number(r.total_score).toFixed(2)}</td>
                {DIMENSIONS.map((d) => {
                  const s = scores?.[d];
                  return <td key={d} className="p-1 font-mono" title={s?.reason ?? ""}>{s ? s.score.toFixed(2) : "—"}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
