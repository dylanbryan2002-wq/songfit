/** Voice + music levels for the picker. Percent is what the sliders show; gain is what Web Audio takes. */
export const DEFAULT_VOICE = 100;
export const DEFAULT_MUSIC = 50;

export function clampPercent(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, Math.round(p)));
}

export function percentToGain(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, p)) / 100;
}
