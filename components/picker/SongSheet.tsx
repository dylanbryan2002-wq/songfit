import type { ReactNode } from "react";

/** The white sheet over the bottom of the video, with a grab handle like TikTok's "Add sound" sheet. */
export function SongSheet({ hint, children }: { hint: string | null; children: ReactNode }) {
  return (
    <section
      aria-label="Songs"
      className="relative -mt-4 w-full rounded-t-3xl bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_30px_rgba(0,0,0,0.08)]"
    >
      <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15" />
      <div className="px-2 pb-2">
        <h1 className="text-xl font-semibold text-ink">Your songs</h1>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
