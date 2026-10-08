/** The slice of the Supabase browser auth client used here (stubbed in tests). */
export type AnonAuth = {
  getSession(): Promise<{ data: { session: unknown } }>;
  signInAnonymously(): Promise<{ error: unknown }>;
};

/**
 * Before the first upload: reuse any session, else sign in anonymously. "failed" (provider off,
 * rate-limited, network) means the landing page falls back to the Google button.
 */
export async function ensureAnonSession(auth: AnonAuth): Promise<"existing" | "started" | "failed"> {
  try {
    const { data } = await auth.getSession();
    if (data.session) return "existing";
    const { error } = await auth.signInAnonymously();
    return error ? "failed" : "started";
  } catch {
    return "failed";
  }
}
