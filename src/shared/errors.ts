export type PipelineStage = "upload" | "analyze" | "recommend";

/**
 * Thrown by any pipeline stage. `raw` carries the model's raw text when a
 * response failed to parse so the admin can see exactly what came back.
 */
export class PipelineError extends Error {
  readonly stage: PipelineStage;
  readonly raw: string | undefined;

  constructor(stage: PipelineStage, message: string, raw?: string) {
    super(message); // plain message; `stage` is a property so callers and tests match on text alone
    this.name = "PipelineError";
    this.stage = stage;
    this.raw = raw;
  }

  override toString(): string {
    return `PipelineError[${this.stage}]: ${this.message}`;
  }
}

export function isPipelineError(e: unknown): e is PipelineError {
  return e instanceof PipelineError;
}

/** Thrown by createSubmission() when the database refuses a submission because the free result is used up. */
export class PaywallError extends Error {
  readonly reason = "needs_subscription" as const;
  constructor() {
    super("needs_subscription");
    this.name = "PaywallError";
  }
}

/** Thrown by createSubmission() when create_submission() refuses on a 24 h cap (per creator or site-wide). */
export class SubmissionLimitError extends Error {
  readonly reason: "daily_limit" | "global_limit";
  constructor(reason: "daily_limit" | "global_limit") {
    super(reason);
    this.name = "SubmissionLimitError";
    this.reason = reason;
  }
}

export function isPaywallError(e: unknown): e is PaywallError {
  return e instanceof PaywallError;
}
