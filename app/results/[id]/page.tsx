import { notFound, redirect } from "next/navigation";
import { getCreator, isAdmin } from "@/src/auth/session";
import { getSubmission, markSubmissionViewed } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";
import { loadPicker } from "@/src/feedback/picker";
import { getSignedPlaybackUrl } from "@/src/media/storage";
import { SubmissionStatus } from "@/src/shared/types";
import { isUuid } from "@/src/shared/ids";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { WaitingState } from "@/components/WaitingState";
import { SongPicker } from "@/components/picker/SongPicker";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, creator] = await Promise.all([params, getCreator()]);
  if (!creator) redirect("/");

  if (!isUuid(id)) notFound();
  const submission = await getSubmission(id);
  if (!submission) notFound();
  if (submission.creator_id !== creator.id && !isAdmin(creator)) notFound();

  const ready = submission.status === "ready";
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
          : "mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-10 px-4 pb-10 pt-10"
      }
    >
      <header className="flex w-full items-center justify-between">
        <Link href="/" aria-label="Songfit home">
          <Logo />
        </Link>
        <Link href="/" className="min-h-11 rounded-full px-3 text-sm font-semibold text-steel-dark">
          ← Upload another
        </Link>
      </header>
      {picker && videoUrl ? (
        <SongPicker data={picker} videoUrl={videoUrl} />
      ) : (
        <WaitingState submissionId={id} initialStatus={SubmissionStatus.parse(submission.status)} />
      )}
    </main>
  );
}
