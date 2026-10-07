/** Thrown when model output holds no parseable JSON. `raw` is the full model text for the admin inspector. */
export class JsonExtractError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "JsonExtractError";
    this.raw = raw;
  }
}

/**
 * Pulls the first JSON object or array out of model text. Strips a ```json fence
 * if present, then parses from the first `{` or `[` to the matching last closer.
 * Returns `unknown`; callers validate with Zod.
 */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();

  const firstObj = t.indexOf("{");
  const firstArr = t.indexOf("[");
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  if (starts.length === 0) throw new JsonExtractError("no JSON value found in model output", text);

  // A `{` or `[` was found: from here on any failure is "invalid JSON", never "no JSON".
  const start = Math.min(...starts);
  const closer = t[start] === "{" ? "}" : "]";
  const end = t.lastIndexOf(closer);
  const slice = end > start ? t.slice(start, end + 1) : t.slice(start);
  try {
    return JSON.parse(slice);
  } catch (e) {
    throw new JsonExtractError(`invalid JSON in model output: ${(e as Error).message}`, text);
  }
}
