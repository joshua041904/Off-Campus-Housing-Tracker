/**
 * Typed classification for POST /insights/listing-feel catch handler (soft degraded path).
 * Used for logs, Prometheus labels, and structured client fields — not for masking root causes.
 */

import { isAIFailure } from "./aiFailure.js";

export type ListingFeelFailureClass = {
  /** Stable machine code, e.g. AI_TIMEOUT */
  code: string;
  /** Short safe substring for JSON (never full stack in prod UI) */
  detail: string;
};

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function nameOf(err: unknown): string {
  return err instanceof Error ? err.name : "";
}

/**
 * Map thrown errors from `analyzeListingFeelText` (or DB/cache around it) to a small taxonomy.
 */
export function classifyListingFeelHttpFailure(err: unknown): ListingFeelFailureClass {
  if (isAIFailure(err)) {
    return { code: err.code, detail: msgOf(err).slice(0, 240) };
  }
  const msg = msgOf(err);
  const name = nameOf(err);
  const combined = `${name} ${msg}`;

  if (name === "TimeoutError" || /AbortError|aborted|timeout/i.test(combined)) {
    return { code: "AI_TIMEOUT", detail: msg.slice(0, 240) };
  }
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|EPIPE|fetch failed|network|socket/i.test(combined)) {
    return { code: "AI_CONNECTION", detail: msg.slice(0, 240) };
  }
  if (/SQL|postgres|relation|violat|pool|ECONN.*db/i.test(combined)) {
    return { code: "AI_PERSISTENCE", detail: msg.slice(0, 240) };
  }
  if (/\[listing-feel\]|OLLAMA_REQUIRED|NO_SILENT_FALLBACK|OLLAMA_BASE_URL unset/i.test(combined)) {
    return { code: "AI_UPSTREAM_CONFIG", detail: msg.slice(0, 240) };
  }
  if (/CHAOS|AI_CHAOS_MODE/i.test(combined)) {
    return { code: "AI_CHAOS", detail: msg.slice(0, 240) };
  }
  return { code: "AI_FATAL", detail: msg.slice(0, 240) };
}
