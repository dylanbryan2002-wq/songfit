/** The waiting screen's estimate: `eta` is what is shown now, `initial` the first estimate (sets the bar's scale). */
export type Eta = { eta: number; initial: number };

/** The upload is the first 15% of the bar; the wait for results is the rest. */
export const UPLOAD_SHARE = 0.15;
const CAP = 0.95;

export function etaLabel(seconds: number): string {
  if (seconds >= 90) return `About ${Math.round(seconds / 60)} min left`;
  if (seconds >= 45) return "About 1 min left";
  if (seconds > 0) return "Under a minute";
  return "Almost done";
}

/** Folds a new server estimate in. The shown time only ever goes down. */
export function nextEta(prev: Eta | null, incoming: number | null): Eta | null {
  if (incoming === null) return prev;
  if (!prev) return { eta: incoming, initial: incoming };
  return { eta: Math.min(prev.eta, incoming), initial: prev.initial };
}

/** One second passes between polls. */
export function tickEta(prev: Eta | null): Eta | null {
  return prev && { eta: Math.max(0, prev.eta - 1), initial: prev.initial };
}

/** Bar fill 0..1 while the video uploads (progress is 0..100). */
export function uploadFill(progress: number): number {
  return (Math.min(100, Math.max(0, progress)) / 100) * UPLOAD_SHARE;
}

/** Bar fill 0..1 while the run works: picks up where the upload ended, never full until ready. */
export function waitingFill(e: Eta | null): number {
  if (!e) return UPLOAD_SHARE;
  if (e.initial <= 0) return CAP;
  return Math.min(CAP, UPLOAD_SHARE + (1 - UPLOAD_SHARE) * (1 - e.eta / e.initial));
}
