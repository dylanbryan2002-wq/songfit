import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg">We couldn&apos;t find that Songfit.</p>
      <p className="text-sm text-muted">
        Results open only for the account that uploaded the video. If this link was shared with you, sign in
        with that account, or make your own.
      </p>
      <Link href="/results/latest" className="min-h-11 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white">
        Open my latest result
      </Link>
      <Link href="/" className="min-h-11 py-3 text-sm underline underline-offset-2">
        Upload a video
      </Link>
    </main>
  );
}
