import Anthropic from "@anthropic-ai/sdk";
import { env, LIMITS } from "./config";
import { logger } from "./logger";

export type ClaudeCall = (args: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number; // per-call override; defaults to LIMITS.modelTimeoutMs (or the makeClaudeCall default)
}) => Promise<string>;

/**
 * Builds a text-in / text-out caller around an Anthropic client. Every text-only
 * stage (candidates, scoring, explanations) uses this; tests inject a stub client.
 * `timeoutMs` is passed as the SDK request timeout so a hung call cannot eat the
 * pipeline budget.
 */
export function makeClaudeCall(
  client: Pick<Anthropic, "messages">,
  opts: { timeoutMs?: number } = {},
): ClaudeCall {
  const defaultTimeout = opts.timeoutMs ?? LIMITS.modelTimeoutMs;
  return async ({ model, system, user, maxTokens = 4000, timeoutMs }) => {
    const started = Date.now();
    const res = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      },
      { timeout: timeoutMs ?? defaultTimeout },
    );
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    // One structured line per model call so cost and truncation are visible in logs (ruling I1).
    logger.info("model.call", {
      model,
      ms: Date.now() - started,
      input_tokens: res.usage?.input_tokens ?? null,
      output_tokens: res.usage?.output_tokens ?? null,
      stop_reason: res.stop_reason ?? null,
    });
    if (res.stop_reason === "max_tokens") throw new Error("claude: output truncated at max_tokens");
    if (!text) throw new Error("claude: no text in response");
    return text;
  };
}

let singleton: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (!singleton) singleton = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  return singleton;
}

/** Default caller used in production. Lazily constructs the client so tests never need a key. */
export const callClaude: ClaudeCall = (args) => makeClaudeCall(defaultClient())(args);
