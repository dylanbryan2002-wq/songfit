import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/src/auth/session";
import { listAccountRuns, parseRunCursor, type AccountRun } from "@/src/db/queries/account";
import { logEvent } from "@/src/feedback/events";
import { ResultsHeader } from "@/components/ResultsHeader";
import { SignOutButton } from "@/components/SignOutButton";
import { VideoIcon } from "@/components/landing/FileCard";
import { runDate, runLine } from "@/components/accountCopy";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { DeleteVideoButton } from "@/components/account/DeleteVideoButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Songfits · Songfit" };

type Search = { before?: string | string[] };

/** "My Songfits": the Google creator's videos, newest first, 20 a page. Anonymous visitors go home. */
export default async function AccountPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [viewer, params] = await Promise.all([getViewer(), searchParams]);
  if (!viewer || viewer.anonymous || !viewer.email) redirect("/");
  const before = parseRunCursor(params.before);
  const { runs, next } = await listAccountRuns(viewer.id, before);
  await logEvent({ name: "account_viewed", creatorId: viewer.id });
  const now = new Date();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      <ResultsHeader />
      <h1 className="text-2xl font-semibold tracking-tight text-ink">My Songfits</h1>

      {runs.length === 0 ? (
        <p className="text-sm text-ink">
          {before ? "No more videos." : "No videos yet."}{" "}
          <Link href="/" className="font-semibold text-steel-dark underline underline-offset-2">
            Upload a video
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center justify-end gap-x-2">
              <RunRow run={run} now={now} />
              {/* Outside the row link: a tap on Delete never opens the results. */}
              <DeleteVideoButton submissionId={run.id} label="Delete" after="refresh" />
            </li>
          ))}
        </ul>
      )}
      {next && (
        <Link
          href={`/account?before=${encodeURIComponent(next)}`}
          className="flex min-h-11 items-center justify-center rounded-full bg-ink/5 text-sm font-semibold text-ink"
        >
          Show more
        </Link>
      )}

      <section className="mt-auto flex flex-col gap-2 border-t border-ink/10 pt-6 text-xs leading-relaxed text-muted">
        <h2 className="font-semibold text-ink">What&apos;s stored</h2>
        <p>
          Your account details, uploaded videos, the analysis of them, song results and activity.{" "}
          <a href="/privacy" className="underline underline-offset-2">
            Privacy
          </a>
        </p>
        <p className="flex flex-wrap items-center gap-1">
          Signed in as {viewer.email}
          <span aria-hidden>·</span>
          <SignOutButton className="!min-h-8 !px-1 text-xs" />
        </p>
        <DeleteAccount />
      </section>
    </main>
  );
}

function RunRow({ run, now }: { run: AccountRun; now: Date }) {
  const artwork = run.status === "ready" ? (run.chosen?.artwork_url ?? null) : null;
  return (
    <Link href={`/results/${run.id}`} className="flex min-h-16 min-w-0 flex-1 basis-64 items-center gap-3 rounded-2xl bg-white p-2 ring-1 ring-inset ring-ink/10 active:scale-[0.99]">
      {artwork ? (
        // Plain img: artwork hosts vary and a 56px square needs no optimisation.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={artwork} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-xl object-cover" />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-ink/5">
          <VideoIcon className="h-6 w-6" />
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="text-xs text-muted">{runDate(run.created_at, now)}</span>
        <span className="truncate text-sm font-semibold text-ink">{runLine(run)}</span>
      </span>
    </Link>
  );
}
