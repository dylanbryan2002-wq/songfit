/**
 * True when the request's Origin header names this site's host. Browsers send Origin on every
 * DELETE, so a missing one is refused too. Guards destructive routes against cross-site requests.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host") ?? new URL(request.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
