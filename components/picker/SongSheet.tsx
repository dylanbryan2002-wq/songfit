import type { ReactNode } from "react";

/** The white sheet under the video, with a grab handle like TikTok's "Add sound" sheet. */
export function SongSheet({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Songs"
      className="w-full rounded-2xl bg-white px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-sm ring-1 ring-ink/5"
    >
      <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink/15" />
      {children}
    </section>
  );
}
