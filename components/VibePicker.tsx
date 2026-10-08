"use client";
import { useEffect, useState } from "react";
import { VIBE_GROUPS, VIBE_MAX_TAGS } from "@/src/shared/vibe";
import { toggleVibeTag } from "./vibeTags";

/** Last chip. Not a tag: it points at the "Anything else?" note and never counts toward the 3. */
export const SOMETHING_ELSE = "Something else…";

const CHIP = "flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold active:scale-[0.98] disabled:opacity-60";
const CHIP_OFF = "border-gray-200 bg-white text-ink/80";

/** "How should it feel?": optional chips, up to 3. Skipping changes nothing. */
export function VibePicker({
  tags,
  onChange,
  onSomethingElse,
  disabled,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  onSomethingElse: () => void;
  disabled?: boolean;
}) {
  const [capHint, setCapHint] = useState(false);
  const full = tags.length >= VIBE_MAX_TAGS;

  useEffect(() => {
    if (!capHint) return;
    const t = setTimeout(() => setCapHint(false), 1500);
    return () => clearTimeout(t);
  }, [capHint]);

  function tap(tag: string) {
    const next = toggleVibeTag(tags, tag);
    if (next === tags) setCapHint(true); // full: never swap silently
    else onChange(next);
  }

  return (
    <fieldset className="flex w-full flex-col" disabled={disabled}>
      <legend className="mb-3">
        <span className="block text-base font-semibold text-ink">How should it feel?</span>
        <span className="block text-sm text-muted">Tap up to 3. Optional.</span>
      </legend>
      <div className="flex flex-col gap-3">
        {VIBE_GROUPS.map((group, i) => (
          <div key={i} className="flex flex-wrap gap-1.5">
            {group.map((tag) => {
              const on = tags.includes(tag);
              const dim = full && !on;
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  aria-disabled={dim || undefined}
                  onClick={() => tap(tag)}
                  className={`${CHIP} ${on ? "border-ink bg-ink text-white" : CHIP_OFF} ${dim ? "opacity-40" : ""}`}
                >
                  {on && (
                    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {tag}
                </button>
              );
            })}
            {i === VIBE_GROUPS.length - 1 && (
              <button type="button" onClick={onSomethingElse} className={`${CHIP} ${CHIP_OFF}`}>
                {SOMETHING_ELSE}
              </button>
            )}
          </div>
        ))}
      </div>
      <p aria-live="polite" className={`mt-3 text-sm ${capHint ? "font-semibold text-ink" : "text-muted"}`}>
        {capHint ? "Up to 3" : "Skip this and we'll figure it out from your video."}
      </p>
    </fieldset>
  );
}
