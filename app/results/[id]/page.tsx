import { notFound, redirect } from "next/navigation";
import { getCreator, isAdmin } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { SubmissionStatus } from "@/src/shared/types";
import { isUuid } from "@/src/shared/ids";
import { Logo } from "@/components/Logo";
import { WaitingState } from "@/components/WaitingState";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, creator] = await Promise.all([params, getCreator()]);
  if (!creator) redirect("/");

  if (!isUuid(id)) notFound();
  const submission = await getSubmission(id);
  if (!submission) notFound();
  if (submission.creator_id !== creator.id && !isAdmin(creator)) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-10 px-4 pb-10 pt-10">
      <Logo />
      {submission.status === "ready" ? (
        // Phase 3 replaces this block with the recommendation cards.
        <h1 className="text-2xl font-semibold text-neutral-900">Ready</h1>
      ) : (
        <WaitingState submissionId={id} initialStatus={SubmissionStatus.parse(submission.status)} />
      )}
    </main>
  );
}
