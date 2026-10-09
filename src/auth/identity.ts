/** The fields of a Supabase auth user this check reads. */
export type AuthUserLike = {
  email?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: { provider?: string } | null;
  identities?: { provider: string }[] | null;
};

/**
 * The email of a Google-confirmed user, or null. Songfit signs in with Google only; a session from any
 * other provider (email/password, phone) or with an unconfirmed email is treated as no session, so a
 * dashboard toggle can never turn someone into the admin or another creator (audit 22, F5/M2).
 */
export function googleEmail(user: AuthUserLike): string | null {
  const google = user.app_metadata?.provider === "google" || !!user.identities?.some((i) => i.provider === "google");
  if (!google || !user.email_confirmed_at || !user.email) return null;
  return user.email;
}
