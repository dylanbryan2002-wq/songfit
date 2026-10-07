import { notFound, redirect } from "next/navigation";
import { getCreator, isAdmin } from "@/src/auth/session";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { getSubmission, markSubmissionViewed } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";
import { toRecommendationView } from "@/src/feedback/recommendationView";
import { SubmissionStatus } from "@/src/shared/types";
import { isUuid } from "@/src/shared/ids";
import { Logo } from "@/components/Logo";
import { WaitingState } from "@/components/WaitingState";
import { ResultsView } from "@/components/ResultsView";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, creator] = await Promise.all([params, getCreator()]);
  if (!creator) redirect("/");

  if (!isUuid(id)) notFound();
  const submission = await getSubmission(id);
  if (!submission) notFound();
  if (submission.creator_id !== creator.id && !isAdmin(creator)) notFound();

  const ready = submission.status === "ready";
  const recommendations = ready ? (await listRecommendations(id)).map(toRecommendationView) : [];
  // Only the owner's first ready view counts; admins browsing never do. The conditional update
  // returns true for exactly one concurrent request, so the event logs once.
  if (ready && submission.creator_id === creator.id && !submission.viewed_at && (await markSubmissionViewed(id))) {
    await logEvent({ name: "recommendations_viewed", creatorId: submission.creator_id, submissionId: id });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-10 px-4 pb-10 pt-10">
      <Logo />
      {ready ? (
        <ResultsView submission={{ id: submission.id }} recommendations={recommendations} />
      ) : (
        <WaitingState submissionId={id} initialStatus={SubmissionStatus.parse(submission.status)} />
      )}
    </main>
  );
}
