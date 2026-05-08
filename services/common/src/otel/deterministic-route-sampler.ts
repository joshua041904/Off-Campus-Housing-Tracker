import { createHash } from "node:crypto";
import type { Context } from "@opentelemetry/api";
import type { Link, SpanAttributes, SpanKind } from "@opentelemetry/api";
import { SamplingDecision, type SamplingResult, type Sampler } from "@opentelemetry/sdk-trace-base";

/**
 * Baseline sampling from trace id only: same trace always gets the same decision across services.
 * Uses SHA-256(traceId) → [0,1) compare to {@link defaultRate} (not the SDK's trace-id ratio algorithm).
 */
export class DeterministicRouteSampler implements Sampler {
  constructor(private readonly defaultRate: number) {}

  shouldSample(
    _context: Context,
    traceId: string,
    _spanName: string,
    _spanKind: SpanKind,
    _attributes: SpanAttributes,
    _links: Link[],
  ): SamplingResult {
    const hash = createHash("sha256").update(traceId).digest("hex");
    const value = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
    if (value < this.defaultRate) {
      return { decision: SamplingDecision.RECORD_AND_SAMPLED };
    }
    return { decision: SamplingDecision.NOT_RECORD };
  }

  toString(): string {
    return `DeterministicRouteSampler(${(this.defaultRate * 100).toFixed(1)}%)`;
  }
}
