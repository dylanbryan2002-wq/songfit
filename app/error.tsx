"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg">Something went wrong. Give it another go.</p>
      <button onClick={reset} className="rounded-full bg-black px-6 py-3 text-white">
        Try again
      </button>
    </main>
  );
}
