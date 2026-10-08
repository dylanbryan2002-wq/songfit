export const MODELS = {
  analysis: "claude-fable-5-1",
  candidates: "claude-sonnet-5-5",
  scoring: "claude-sonnet-5-5",
  explain: "claude-sonnet-5-5",
  whisper: "whisper-1",
} as const;

export const LIMITS = {
  maxUploadBytes: 50 * 1024 * 1024, // Supabase free tier per-object limit
  maxDurationSeconds: 180,
  maxFrames: 60,
  frameWidth: 512,
  candidatesPerDirection: 25,
  deezerConcurrency: 6,
  deezerMinIntervalMs: 120, // ≈8 req/s, under Deezer's ~50 req / 5 s per IP
  deezerTimeoutMs: 8_000,
  sectionMin: 12,
  sectionMax: 20,
  sectionDefault: 15,
  pipelineBudgetMs: 280_000,
  modelTimeoutMs: 120_000,
  inFlightStaleMinutes: 6,
  dailyUploadsPerCreator: 10, // spend cap: submissions created per rolling 24 h
} as const;

/** Ranked picks per submission, shown PICKS_PER_BATCH at a time; fewer than PICKS_MIN verified fails the stage. */
export const PICKS_TOTAL = 15;
export const PICKS_PER_BATCH = 5;
export const PICKS_MIN = 3;

/**
 * C8 ruling: previews need Dylan's go. He enabled them on 2026-10-07 (song-picker spec, option a).
 * Gates only the picker's play buttons. Verification always reads the Deezer preview: no sample, no
 * recommendation (samples-only rule, 2026-10-07).
 */
export const PREVIEWS_ENABLED = true;

/** Must match the literal in the create_submission() SQL function (supabase/migrations/0001_init.sql). */
export const FREE_RESULTS_PER_CREATOR = 1;
/** Dylan, 2026-10-07: no gate until Stripe ships. Migration 0006 lifts the database rule too. */
export const PAYWALL_ENABLED = false;

export const CONTENT_CATEGORIES = [
  "fashion",
  "beauty",
  "fitness",
  "travel",
  "food",
  "lifestyle",
  "comedy",
  "music",
  "dance",
  "education",
  "business",
  "gaming",
  "pets",
  "family",
  "other",
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

/** Read a required environment variable. Throws with the variable name if unset or empty. */
export function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Comma-separated admin emails, lower-cased. Empty array if unset. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
