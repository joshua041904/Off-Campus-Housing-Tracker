/** Typed AI pipeline failures (timeouts, etc.) for explicit HTTP responses when stabilizing. */

export const AI_FAILURE_TIMEOUT = "AI_TIMEOUT" as const;

export class AIFailure extends Error {
  readonly code: string;
  readonly meta: Record<string, unknown>;

  constructor(code: string, message: string, meta: Record<string, unknown> = {}) {
    super(message);
    this.name = "AIFailure";
    this.code = code;
    this.meta = meta;
  }
}

export function isAIFailure(err: unknown): err is AIFailure {
  return err instanceof AIFailure;
}
