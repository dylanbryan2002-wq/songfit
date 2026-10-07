import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg">We couldn&apos;t find that Songfit.</p>
      <Link href="/" className="underline">
        Upload a video
      </Link>
    </main>
  );
}
