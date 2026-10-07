/** Returns a same-origin path (with query and hash) for post-login redirects, else "/". */
export function safeNext(nextParam: string | null, origin: string): string {
  try {
    const target = new URL(nextParam ?? "/", origin);
    const path = target.pathname + target.search + target.hash;
    if (target.origin === origin && path.startsWith("/") && !path.startsWith("//")) return path;
  } catch {
    // fall through
  }
  return "/";
}
