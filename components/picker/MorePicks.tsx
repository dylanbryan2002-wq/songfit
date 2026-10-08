"use client";

import { useState } from "react";

// Same look as the Use-it panel's secondary buttons (P5).
const secondary =
  "flex min-h-12 w-full items-center justify-center rounded-xl border border-ink/10 bg-white px-3 text-sm font-semibold text-ink transition-[transform,background-color] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100";

/** Under the song list: "Show 5 more", or the "None of these?" one-line box. */
export function MorePicks({
  control,
  wantedSent,
  onShowMore,
  onSend,
}: {
  control: "more" | "wanted";
  wantedSent: boolean;
  onShowMore: () => void;
  onSend: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  if (control === "more") {
    return (
      <button type="button" onClick={onShowMore} className={`${secondary} mt-3`}>
        Show 5 more
      </button>
    );
  }
  if (wantedSent) return <p role="status" className="mt-3 px-2 text-center text-sm font-medium text-ink">Got it. We&apos;ll use that.</p>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${secondary} mt-3`}>
        None of these? Tell us what you wanted
      </button>
    );
  }
  const trimmed = text.trim();
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed) onSend(trimmed);
      }}
    >
      <input
        autoFocus
        aria-label="What you wanted"
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. slower, more 2000s, no vocals"
        className="min-h-12 min-w-0 flex-1 rounded-xl border border-ink/10 bg-white px-3 text-base text-ink"
      />
      <button type="submit" disabled={!trimmed} className={`${secondary} w-auto shrink-0 px-5 disabled:opacity-50`}>
        Send
      </button>
    </form>
  );
}
