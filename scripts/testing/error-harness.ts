/**
 * Type-level helpers for forcing dependency failures in Vitest.
 * Runtime helpers: `scripts/testing/error-harness.mjs`.
 */
export type ForcedUpstreamError = Error & { code?: string };

export function forcedUpstreamError(message = "upstream failure"): ForcedUpstreamError {
  return Object.assign(new Error(message), { code: "UPSTREAM" });
}
