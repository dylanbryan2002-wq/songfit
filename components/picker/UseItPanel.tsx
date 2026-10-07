"use client";

import { useEffect, useRef, useState } from "react";
import type { PickerRow } from "@/src/shared/types";
import { formatTime } from "@/src/shared/format";

export type Destination = "tiktok" | "instagram" | "spotify";

type Props = {
  row: PickerRow;
  showTrimNote: boolean;
  onCopied: () => void;
  onOpen: (destination: Destination) => void;
  onNotFound: () => void;
};

const action =
  "flex min-h-12 items-center justify-center rounded-xl px-3 text-sm font-semibold transition-colors active:scale-[0.98]";

/** The full-track section and the ways to go use it. Never derived from the sample (C2). */
export function UseItPanel({ row, showTrimNote, onCopied, onOpen, onNotFound }: Props) {
  const label = `${row.title} · ${row.artist}`;
  const query = encodeURIComponent(`${row.title} ${row.artist}`);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const [reported, setReported] = useState(false);
  const [pasteHint, setPasteHint] = useState<"TikTok" | "Instagram" | null>(null);
  const manualRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (manualCopy) manualRef.current?.select();
  }, [manualCopy]);

  const copy = () => {
    onCopied();
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(label).then(done, () => setManualCopy(true));
    } else {
      setManualCopy(true);
    }
  };

  // Phone test 2026-10-07: the TikTok and Instagram apps open but ignore the search in the link
  // (Universal Links drop the path), so copy the song name on the same tap and say so.
  const link = (destination: Destination, href: string, text: string) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        onOpen(destination);
        if (destination !== "spotify") {
          navigator.clipboard?.writeText(label).catch(() => undefined);
          setPasteHint(destination === "tiktok" ? "TikTok" : "Instagram");
        }
      }}
      className={`${action} border border-ink/10 bg-white text-ink`}
    >
      {text}
    </a>
  );

  return (
    <section className="mx-2 mt-3 rounded-xl bg-canvas p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Use it for real</h2>
      <p className="mt-1 text-ink">
        <span className="text-2xl font-bold">
          Use {formatTime(row.start_seconds)}–{formatTime(row.end_seconds)}
        </span>{" "}
        <span className="text-sm font-medium text-muted">of the full track</span>
      </p>
      {showTrimNote && <p className="mt-0.5 text-xs text-muted">(Trimming the sample does not change this.)</p>}
      <p className="mt-3 text-sm text-ink/80">
        {pasteHint
          ? `Copied. Paste "${label}" into ${pasteHint}'s search, then use that part.`
          : "Open TikTok or Instagram, paste the song name into search, then use that part."}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={copy} className={`${action} flex-col bg-ink text-white`}>
          <span>{copied ? "Copied" : "Copy"}</span>
          <span className="w-full truncate text-xs font-normal text-white/70">{label}</span>
        </button>
        {link("tiktok", `https://www.tiktok.com/search?q=${query}`, "Open TikTok")}
        {link("instagram", `https://www.instagram.com/explore/search/keyword/?q=${query}`, "Open Instagram")}
        {link("spotify", row.spotify_url, "Open in Spotify")}
      </div>

      {manualCopy && (
        <label className="mt-3 block text-xs text-muted">
          Press and hold to copy
          <input
            ref={manualRef}
            readOnly
            value={label}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-1 block w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink"
          />
        </label>
      )}

      <p className="mt-4 text-[13px] text-muted">
        {reported ? (
          "Thanks, noted."
        ) : (
          <>
            Couldn&apos;t find it in TikTok or Instagram?{" "}
            <button
              type="button"
              onClick={() => {
                setReported(true);
                onNotFound();
              }}
              className="min-h-11 px-1 font-semibold text-steel-dark underline underline-offset-2"
            >
              Tell us
            </button>
          </>
        )}
      </p>
    </section>
  );
}
