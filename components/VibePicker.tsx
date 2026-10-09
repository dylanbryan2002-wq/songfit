"use client";
import { useEffect, useState } from "react";
import { STORYTELLING_TAGS, VIBE_MAX_TAGS, VIBE_TAGS } from "@/src/shared/vibe";
import { storytellingOn, storytellingOpenAfterTap, toggleVibeTag } from "./vibeTags";

/** Last chip. Not a tag: it points at the "Anything else?" note and never counts toward the 3. */
export const SOMETHING_ELSE = "Something else…";
/** Parent chip. Not a tag: it reveals the three Storytelling sub-chips. */
export const STORYTELLING = "Storytelling";
export const HELPER = "Optional. Tap up to 3, or skip it and we'll read your video.";

const MAIN_TAGS = VIBE_TAGS.filter((t) => !(STORYTELLING_TAGS as readonly string[]).includes(t));

const CHIP = "flex items-center gap-1.5 rounded-full font-medium active:scale-[0.98] disabled:opacity-60";
const MAIN = "h-10 px-4 text-[15px]";
const SUB = "h-9 px-3.5 text-sm";
const ON = "bg-ink text-white";
const OFF = "bg-ink/5 text-ink";

function Check() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  const [storyTapped, setStoryTapped] = useState(false);
  const full = tags.length >= VIBE_MAX_TAGS;
  const storyOn = storytellingOn(tags);
  const storyOpen = storyTapped || storyOn;

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

  function tapStory() {
    if (full && !storyOn && !storyOpen) setCapHint(true);
    else setStoryTapped(storytellingOpenAfterTap(storyOpen, tags));
  }

  function chip(tag: string, size: string, label = tag) {
    const on = tags.includes(tag);
    const dim = full && !on;
    return (
      <button
        key={tag}
        type="button"
        aria-pressed={on}
        aria-disabled={dim || undefined}
        onClick={() => tap(tag)}
        className={`${CHIP} ${size} ${on ? ON : OFF} ${dim ? "opacity-40" : ""}`}
      >
        {on && <Check />}
        {label}
      </button>
    );
  }

  return (
    <fieldset className="flex w-full flex-col" disabled={disabled}>
      <legend className="text-base font-semibold text-ink">How should it feel?</legend>
      <p aria-live="polite" className={`text-sm ${capHint ? "font-semibold text-ink" : "text-muted"}`}>
        {capHint ? "Up to 3" : HELPER}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {MAIN_TAGS.map((tag) => chip(tag, MAIN))}
        <button
          type="button"
          aria-expanded={storyOpen}
          aria-disabled={(full && !storyOn) || undefined}
          onClick={tapStory}
          className={`${CHIP} ${MAIN} ${storyOn ? ON : OFF} ${full && !storyOn ? "opacity-40" : ""}`}
        >
          {storyOn && <Check />}
          {STORYTELLING}
        </button>
        <button type="button" onClick={onSomethingElse} className={`${CHIP} ${MAIN} ${OFF}`}>
          {SOMETHING_ELSE}
        </button>
      </div>
      {storyOpen && (
        <div className="mt-2 flex flex-wrap gap-2">
          {STORYTELLING_TAGS.map((tag) => chip(tag, SUB, tag.replace(" Storytelling", "")))}
        </div>
      )}
    </fieldset>
  );
}
