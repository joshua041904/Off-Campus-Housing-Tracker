import type { ListingFeelTiming } from "./intelligence/types.js";

export type ListingFeelTimingTransport = ListingFeelTiming &
  Record<string, unknown> & {
    request_wall_ms?: number;
    handler_wall_ms?: number;
    total_server_ms?: number;
    ollama_http_ms?: number;
    response_serialize_ms?: number;
    cold_start_detected?: boolean;
    model_bootstrap_ms?: number;
    model_used?: string;
    http_path?: string;
    listing_fetch_ms?: number;
  };

export function buildListingFeelTimingTransport(input: {
  pipelineTiming: ListingFeelTiming | undefined;
  requestWallMs: number;
  handlerWallMs: number;
  responseSerializeMs: number;
  modelUsed?: string;
  httpPath: string;
  listingFetchMs?: number;
}): ListingFeelTimingTransport {
  const t: ListingFeelTiming = input.pipelineTiming ?? { path: "unknown", server_ms: 0 };
  const ollamaSum = typeof t.ollama_sum_ms === "number" ? t.ollama_sum_ms : undefined;
  const legacyHttp = typeof t.legacy_ollama_http_ms === "number" ? t.legacy_ollama_http_ms : undefined;
  const ollamaHttpMs = legacyHttp ?? ollamaSum;
  const warm = String(t.ollama_warm || "");
  const pathStr = String(t.path || "");
  const coldStartDetected =
    warm === "likely_cold" ||
    (typeof ollamaHttpMs === "number" &&
      ollamaHttpMs >= 12_000 &&
      (pathStr === "legacy_ollama" || pathStr === "li_v2" || pathStr === "rule_based_fallback"));

  const promptBuild = Number(t.prompt_build_ms ?? 0);
  let modelBootstrapMs: number | undefined;
  if (pathStr === "legacy_ollama" && typeof legacyHttp === "number") {
    modelBootstrapMs = Math.max(0, legacyHttp - promptBuild);
  } else if (pathStr === "li_v2" && typeof t.li_v2_wall_ms === "number") {
    const sumO = Number(t.ollama_sum_ms ?? 0);
    modelBootstrapMs = Math.max(0, Number(t.li_v2_wall_ms) - sumO - promptBuild);
  }

  const out: ListingFeelTimingTransport = {
    ...t,
    request_wall_ms: input.requestWallMs,
    handler_wall_ms: input.handlerWallMs,
    total_server_ms: typeof t.server_ms === "number" ? t.server_ms : input.handlerWallMs,
    ollama_http_ms: ollamaHttpMs,
    response_serialize_ms: input.responseSerializeMs,
    cold_start_detected: coldStartDetected,
    model_bootstrap_ms: modelBootstrapMs,
    model_used: input.modelUsed ?? t.ollama_model,
    http_path: input.httpPath,
    ...(typeof input.listingFetchMs === "number" ? { listing_fetch_ms: input.listingFetchMs } : {}),
  };
  return out;
}
