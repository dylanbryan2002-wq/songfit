import { notFound, redirect } from "next/navigation";
import { getCreator, isAdmin } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { loadPicker } from "@/src/feedback/picker";
import { getSignedPlaybackUrl } from "@/src/media/storage";
import { isUuid } from "@/src/shared/ids";
import { PlaybackSpike } from "@/components/picker/PlaybackSpike";

export const dynamic = "force-dynamic";

// Hidden phone-test page for the synced playback hook. Not linked from anywhere.
export default async function SpikePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, creator] = await Promise.all([params, getCreator()]);
  if (!creator) redirect("/");

  if (!isUuid(id)) notFound();
  const submission = await getSubmission(id);
  if (!submission) notFound();
  if (submission.creator_id !== creator.id && !isAdmin(creator)) notFound();

  const [picker, videoUrl] = await Promise.all([loadPicker(id), getSignedPlaybackUrl(submission.video_path, 3600)]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pb-10 pt-6">
      <PlaybackSpike
        videoUrl={videoUrl}
        videoDurationSeconds={picker.video_duration_seconds}
        rows={picker.rows}
      />
    </main>
  );
}
