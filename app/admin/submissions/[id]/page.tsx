import { notFound } from "next/navigation";
import { requireAdmin } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { getAnalysisRow } from "@/src/db/queries/analyses";
import { listCandidates } from "@/src/db/queries/candidates";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { getSignedPlaybackUrl } from "@/src/media/storage";
import { isUuid } from "@/src/shared/ids";
import { formatTime } from "@/src/shared/format";
import { CandidatesTable } from "@/components/admin/CandidatesTable";
import { retrySubmission } from "./actions";

export const dynamic = "force-dynamic";
// The retry server action (./actions.ts) runs the whole pipeline synchronously inside this page's function.
export const maxDuration = 300;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 border-t py-1">
      <dt className="text-neutral-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default async function SubmissionInspectorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(); // ruling M3
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sub = await getSubmission(id);
  if (!sub) notFound();
  const analysis = await getAnalysisRow(id);
  const [candidates, recs] = await Promise.all([listCandidates(id), listRecommendations(id)]);
  let videoUrl: string | null = null;
  try {
    videoUrl = await getSignedPlaybackUrl(sub.video_path);
  } catch {
    videoUrl = null;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">Submission {id.slice(0, 8)}</h1>
        <span className="rounded bg-neutral-100 px-2 py-1 text-sm">{sub.status}</span>
        <form action={retrySubmission}>
          <input type="hidden" name="id" value={id} />
          <button className="rounded border px-3 py-1 text-sm" type="submit">Retry pipeline</button>
        </form>
      </div>

      {/* Raw pipeline error: admin-only. Creators see a generic failed state (Phase 4). */}
      {sub.error && <p className="rounded bg-red-50 p-3 text-sm text-red-800">Error: {sub.error}</p>}

      <section className="grid gap-6 md:grid-cols-[320px_1fr]">
        {videoUrl ? (
          <video controls playsInline className="w-full rounded bg-black" src={videoUrl} />
        ) : (
          <p className="text-sm text-neutral-500">Video unavailable</p>
        )}
        <dl className="text-sm">
          <Row label="Creator intent" value={sub.creator_intent ?? "—"} />
          <Row label="Duration" value={sub.duration_seconds ? `${sub.duration_seconds.toFixed(1)}s` : "—"} />
          <Row label="Category" value={sub.content_category ?? "—"} />
          <Row label="Created" value={new Date(sub.created_at).toLocaleString()} />
          <Row label="Updated" value={new Date(sub.updated_at).toLocaleString()} />
          <Row label="Analyzed" value={sub.analyzed_at ? new Date(sub.analyzed_at).toLocaleString() : "—"} />
          <Row label="Recommended" value={sub.recommended_at ? new Date(sub.recommended_at).toLocaleString() : "—"} />
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Analysis</h2>
        {!analysis ? (
          <p className="text-sm text-neutral-500">No analysis yet.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <dl>
              <Row label="Summary" value={analysis.summary} />
              <Row label="Content type" value={analysis.content_type} />
              <Row label="Category" value={analysis.content_category} />
              <Row label="Setting" value={analysis.setting ?? "—"} />
              <Row label="Story" value={analysis.story ?? "—"} />
              <Row label="Aesthetic" value={(analysis.aesthetic ?? []).join(", ")} />
              <Row label="Mood" value={(analysis.mood ?? []).join(", ")} />
              <Row label="Energy / pacing" value={`${analysis.energy} / ${analysis.pacing}`} />
              <Row label="Spoken dialogue" value={analysis.dialogue_present ? "yes" : "no"} />
              <Row label="Prompt version" value={analysis.prompt_version} />
            </dl>
            <div>
              <h3 className="font-medium">Important moments</h3>
              <pre className="overflow-x-auto rounded bg-neutral-50 p-3">{JSON.stringify(analysis.important_moments, null, 2)}</pre>
            </div>
            <div>
              <h3 className="font-medium">Music brief</h3>
              <p className="whitespace-pre-wrap rounded bg-neutral-50 p-3">{analysis.music_brief}</p>
              <pre className="mt-2 overflow-x-auto rounded bg-neutral-50 p-3">{JSON.stringify(analysis.music_brief_fields, null, 2)}</pre>
            </div>
            <div>
              <h3 className="font-medium">Transcript (words heard, spoken or sung)</h3>
              <p className="whitespace-pre-wrap rounded bg-neutral-50 p-3">{analysis.transcript || "(nothing heard)"}</p>
            </div>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Final picks</h2>
        {recs.length === 0 ? <p className="text-sm text-gray-500">none yet</p> : (
          <ol className="mt-2 space-y-2 text-sm">
            {recs.map((r) => (
              <li key={r.id}>
                <b>#{r.rank} {r.direction_label}</b>: {r.title} — {r.artist}, use {formatTime(Number(r.start_seconds))}–{formatTime(Number(r.end_seconds))}
                {r.aligned_to_moment !== null && <span className="text-gray-500"> (aligned to {r.aligned_to_moment}s)</span>}
                <div className="text-gray-600">{r.explanation}</div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Candidates ({candidates.length}, {candidates.filter((c) => c.verified).length} verified)</h2>
        <CandidatesTable rows={candidates} />
      </section>
    </div>
  );
}
