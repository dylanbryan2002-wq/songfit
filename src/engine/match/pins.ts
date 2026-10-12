// Songs Dylan pinned to #1 for one video (2026-10-12: "for this same video ... make the voyager the number one reced song").
// Matched on a line from the transcript, so any copy of the video (phone or Mac upload) gets the pin; the engine fills the rest.
const PINS: { phrase: string; songId: string; note: string }[] = [
  { phrase: "day one of building state", songId: "3135562", note: "Dylan's founder video -> Voyager, Daft Punk" },
];

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The pinned song id for this transcript, or null. */
export function pinFor(transcript: string | null | undefined): string | null {
  const t = plain(transcript ?? "");
  return PINS.find((p) => t.includes(plain(p.phrase)))?.songId ?? null;
}
