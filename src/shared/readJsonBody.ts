/** Parses a small JSON body, or returns null when it is missing, malformed, or over `maxBytes`. */
export async function readJsonBody(request: Request, maxBytes = 4_096): Promise<unknown> {
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).length > maxBytes) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
