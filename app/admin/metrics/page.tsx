import { requireAdmin } from "@/src/auth/session";
import { getMetrics, getVibeMetrics, type VibeMetrics } from "@/src/db/queries/metrics";
import { countReports, listNotFoundReports } from "@/src/db/queries/notFound";

export const dynamic = "force-dynamic";

const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "—");

function vibeRow(v: VibeMetrics) {
  return `Vibe: ${pct(v.tagged.n, v.total)} of submissions tagged · picked a song ${pct(v.tagged.picked, v.tagged.n)} (n=${v.tagged.n}) tagged vs ${pct(v.untagged.picked, v.untagged.n)} (n=${v.untagged.n}) untagged`;
}

function secs(v: number | null) {
  return v === null ? "—" : `${Math.round(v)} s`;
}

export default async function MetricsPage() {
  await requireAdmin();
  const [m, reports, vibe] = await Promise.all([getMetrics(), listNotFoundReports().catch(() => []), getVibeMetrics()]);
  const reported = countReports(reports);
  const count = (name: string) => m.eventCounts.find((e) => e.name === name)?.count ?? 0;
  const notFound = count("song_not_found");
  return (
    <main className="mx-auto max-w-4xl space-y-10 p-6">
      <h1 className="text-2xl font-semibold">Metrics</h1>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Paying creators (active)</div><div className="text-xl">{m.paidCreators}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Paid events</div><div className="text-xl">{m.paidEvents}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Median upload → ready</div><div className="text-xl">{secs(m.medianUploadToReadySeconds)}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Median ready → selection</div><div className="text-xl">{secs(m.medianReadyToSelectionSeconds)}</div></div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Funnel (distinct)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th>Stage</th><th>Submissions</th><th>Creators</th></tr></thead>
            <tbody>
              {m.funnel.map((f) => (
                <tr key={f.stage} className="border-t"><td>{f.stage}</td><td>{f.submissions}</td><td>{f.creators}</td></tr>
              ))}
              <tr className="border-t"><td>Couldn&apos;t find it (reports)</td><td colSpan={2}>{notFound}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Couldn&apos;t find it</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th>Title</th><th>Artist</th><th>Reports</th><th>Creators</th></tr></thead>
            <tbody>
              {reported.length === 0 && <tr className="border-t"><td colSpan={4}>None yet</td></tr>}
              {reported.map((r) => (
                <tr key={r.key} className="border-t"><td>{r.title}</td><td>{r.artist}</td><td>{r.reports}</td><td>{r.creators}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">By category</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th>Category</th><th>Ready</th><th>Selected</th><th>Select rate</th></tr></thead>
            <tbody>
              {m.byCategory.map((c) => (
                <tr key={c.category} className="border-t">
                  <td>{c.category}</td><td>{c.ready}</td><td>{c.selected}</td>
                  <td>{c.ready ? `${Math.round((100 * c.selected) / c.ready)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <p className="text-sm">Returning creators (≥2 uploads): <strong>{m.returningCreators}</strong></p>
        <p className="text-sm">{vibeRow(vibe)}</p>
        {/* Creators above count Google sign-ins only (email not null, 0009); unclaimed runs never do. */}
        <p className="text-sm">
          Anonymous runs: {count("anon_session_started")} started · {count("results_gate_signed_in")} claimed
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-medium">All events (raw counts)</h2>
        <table className="w-full text-sm">
          <tbody>
            {m.eventCounts.map((e) => (
              <tr key={e.name} className="border-t"><td>{e.name}</td><td className="text-right">{e.count}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
