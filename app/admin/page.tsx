import Link from "next/link";
import { requireAdmin } from "@/src/auth/session";
import { listSubmissions } from "@/src/db/queries/submissions";
import { formatElapsed, shortId } from "@/src/db/queries/admin";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage() {
  await requireAdmin(); // ruling M3: every admin page gates itself, not just the layout
  const rows = await listSubmissions();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Submissions ({rows.length})</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-2 pr-4">ID</th>
              <th className="py-2 pr-4">Creator</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4">Upload → analyzed</th>
              <th className="py-2 pr-4">Upload → ready</th>
              <th className="py-2 pr-4">Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-2 pr-4 font-mono">
                  <Link className="underline" href={`/admin/submissions/${r.id}`}>{shortId(r.id)}</Link>
                </td>
                <td className="py-2 pr-4">{r.creator?.email ?? "—"}</td>
                <td className="py-2 pr-4">{r.status}</td>
                <td className="py-2 pr-4">{r.content_category ?? "—"}</td>
                <td className="py-2 pr-4">{new Date(r.created_at).toLocaleString()}</td>
                <td className="py-2 pr-4">{formatElapsed(r.created_at, r.analyzed_at)}</td>
                <td className="py-2 pr-4">{formatElapsed(r.created_at, r.recommended_at)}</td>
                <td className="max-w-xs truncate py-2 pr-4 text-red-700">{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
