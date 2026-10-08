import { notFound, redirect } from "next/navigation";
import { gateDecision } from "@/src/auth/gate";
import { getViewer, isAdmin } from "@/src/auth/session";
import { getSubmission, markSubmissionViewed, type SubmissionVibeColumns } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";
import { loadPicker } from "@/src/feedback/picker";
import { getSignedPlaybackUrl } from "@/src/media/storage";
import { SubmissionStatus } from "@/src/shared/types";
import { isUuid } from "@/src/shared/ids";
import { ResultsHeader, WAITING_MAIN } from "@/components/ResultsHeader";
import { ResultsGate } from "@/components/ResultsGate";
import { WaitingState } from "@/components/WaitingState";
import { SongPicker } from "@/components/picker/SongPicker";
import { vibeLine } from "@/components/vibeTags";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, creator] = await Promise.all([params, getViewer()]);
  if (!creator) redirect("/");

  if (!isUuid(id)) notFound();
  const submission = await getSubmission(id);
  if (!submission) notFound();
  const view = gateDecision({ ...creator, admin: isAdmin(creator) }, submission);
  if (view === "not_found") notFound();
  if (view === "gate") {
    // Anonymous + ready: no picker data, no signed playback URL, no viewed mark until Google sign-in.
    await logEvent({ name: "results_gate_viewed", creatorId: creator.id, submissionId: id });
  }

  const ready = view === "picker";
  const [picker, videoUrl] = ready
    ? await Promise.all([loadPicker(id), getSignedPlaybackUrl(submission.playback_path ?? submission.video_path, 3600)])
    : [null, null];
  // Only the owner's first ready view counts; admins browsing never do. The conditional update
  // returns true for exactly one concurrent request, so the event logs once.
  if (ready && submission.creator_id === creator.id && !submission.viewed_at && (await markSubmissionViewed(id))) {
    await logEvent({ name: "recommendations_viewed", creatorId: submission.creator_id, submissionId: id });
  }

  return (
    <main
      className={
        picker && videoUrl
          ? "mx-auto flex min-h-dvh w-full max-w-md flex-col gap-3 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]"
          : WAITING_MAIN
      }
    >
      <ResultsHeader />
      {view === "gate" ? (
        <ResultsGate submissionId={id} />
      ) : picker && videoUrl ? (
        <SongPicker
          data={picker}
          videoUrl={videoUrl}
          // Cast until `pnpm db:types` includes 0008_vibe.sql.
          vibeLine={vibeLine((submission as Partial<SubmissionVibeColumns>).vibe_tags ?? [])}
        />
      ) : (
        <WaitingState submissionId={id} initialStatus={SubmissionStatus.parse(submission.status)} />
      )}
    </main>
  );
}
