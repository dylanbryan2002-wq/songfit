/** Creator-facing lines for "My Songfits" and the upload screen's allowance. Pure, so they are tested. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Yesterday", "3 Oct" (with the year when it isn't this year). Calendar days in UTC. */
export function runDate(createdAt: string, now: Date): string {
  const d = new Date(createdAt);
  const day = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const label = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? label : `${label} ${d.getUTCFullYear()}`;
}

/** The row's second line: the chosen song, or where the run is. */
export function runLine(run: { status: string; chosen: { title: string; artist: string } | null }): string {
  if (run.status === "failed") return "Didn't work";
  if (run.status !== "ready") return "Finding songs…";
  return run.chosen ? `Chose: ${run.chosen.title} · ${run.chosen.artist}` : "No song chosen yet";
}

/** "7 uploads left" / "2 free tries left", with the reset hint for signed-in creators. */
export function uploadsLeftCopy(left: number, anonymous: boolean): { line: string; hint: string | null } {
  if (anonymous) return { line: `${left} free ${left === 1 ? "try" : "tries"} left`, hint: null };
  return { line: `${left} ${left === 1 ? "upload" : "uploads"} left`, hint: "Resets 24 hours after each upload" };
}
