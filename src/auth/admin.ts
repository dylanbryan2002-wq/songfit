export function isAdminEmail(email: string | null | undefined, list: string): boolean {
  if (!email || !list) return false;
  const needle = email.trim().toLowerCase();
  if (!needle) return false;
  return list
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(needle);
}
