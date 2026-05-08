import type { Context } from "@opentelemetry/api";
import type { Link, SpanAttributes, SpanKind } from "@opentelemetry/api";
import { SamplingDecision, type SamplingResult, type Sampler } from "@opentelemetry/sdk-trace-base";
import { DeterministicRouteSampler } from "./deterministic-route-sampler.js";

/**
 * Root sampler: always record AI / listing-feel / analytics-heavy spans; otherwise delegate to
 * {@link DeterministicRouteSampler} (hash(traceId) ratio — same decision across services for a given trace).
 *
 * Enable with `OTEL_TRACES_SAMPLER=och_ai_preferential` and optional `OTEL_TRACES_SAMPLER_ARG=0.2` (baseline ratio).
 */
export class OchAiPreferentialTraceIdSampler implements Sampler {
  private readonly baseline: DeterministicRouteSampler;

  constructor(baselineRatio: number) {
    this.baseline = new DeterministicRouteSampler(baselineRatio);
  }

  shouldSample(
    _context: Context,
    traceId: string,
    spanName: string,
    _spanKind: SpanKind,
    attributes: SpanAttributes,
    links: Link[],
  ): SamplingResult {
    const route = attributes["http.route"];
    const routeStr = typeof route === "string" ? route : "";
    const name = spanName || "";
    const blob = `${name}\n${routeStr}`.toLowerCase();
    if (
      blob.includes("analytics") ||
      blob.includes("listing-feel") ||
      blob.includes("listing_feel") ||
      blob.includes("/insights/") ||
      blob.includes("intelligence") ||
      blob.includes("analyze")
    ) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }
    return this.baseline.shouldSample(_context, traceId, spanName, _spanKind, attributes, links);
  }

  toString(): string {
    return `OchAiPreferentialTraceIdSampler(${this.baseline})`;
  }
}
