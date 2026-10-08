"use client";
import { VIBE_NOTE_MAX, VIBE_TAGS } from "@/src/shared/vibe";

export type Vibe = { tags: string[]; note: string };

/** "What's the vibe?": optional chips (multi-select) and a one-line note. Skipping changes nothing. */
export function VibePicker({
  value,
  onChange,
  disabled,
}: {
  value: Vibe;
  onChange: (next: Vibe) => void;
  disabled?: boolean;
}) {
  const toggle = (tag: string) =>
    onChange({
      ...value,
      // Keep the chip order, whatever order they were tapped in.
      tags: VIBE_TAGS.filter((t) => (t === tag ? !value.tags.includes(t) : value.tags.includes(t))),
    });

  return (
    <fieldset className="flex w-full flex-col gap-3" disabled={disabled}>
      <legend className="mb-3">
        <span className="block text-base font-semibold text-ink">What&apos;s the vibe?</span>
        <span className="block text-sm text-muted">Optional. Tap all that apply.</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {VIBE_TAGS.map((tag) => {
          const on = value.tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(tag)}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold active:scale-[0.98] disabled:opacity-60 ${
                on ? "border-ink bg-ink text-white" : "border-gray-200 bg-white text-ink"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-ink">Anything else?</span>
        <input
          type="text"
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          maxLength={VIBE_NOTE_MAX}
          placeholder="e.g. the song should be the punchline"
          className="min-h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base"
        />
      </label>
    </fieldset>
  );
}
