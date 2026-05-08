import type { Span } from "@opentelemetry/api";
import { SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("analytics-intelligence");

export type StageAttrs = Record<string, string | number | boolean>;

/**
 * Nested pipeline span — always created (use {@link stageSkipped} for no-op paths).
 * Uses active span parent so depth stays under HTTP / gRPC server spans.
 */
export function runStage<T>(name: string, fn: (span: Span) => Promise<T>, attrs: StageAttrs = {}): Promise<T> {
  return tracer.startActiveSpan(name, async (span: Span) => {
    for (const [k, v] of Object.entries(attrs)) {
      span.setAttribute(k, v);
    }
    try {
      const out = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });
}

export function stageSkipped(span: Span, reason?: string): void {
  span.setAttribute("stage.skipped", true);
  if (reason) span.setAttribute("och.skip_reason", reason);
}

/** Seven nested spans (lock → … → quality) for short-circuit returns; keeps CHILD_OF depth stable. */
export async function listingFeelShortCircuitTail<T extends { analysis_text: string; model_used: string; quality_score: number }>(
  exitKind: string,
  result: T,
): Promise<T> {
  return runStage("analytics.concurrency.lock", async (s1) => {
    stageSkipped(s1, exitKind);
    return runStage("analytics.routing.model_path", async (s2) => {
      stageSkipped(s2, exitKind);
      return runStage("analytics.model.generate", async (s3) => {
        stageSkipped(s3, exitKind);
        return runStage("analytics.upstream.ollama_http", async (s4) => {
          stageSkipped(s4, exitKind);
          return runStage("analytics.model.postprocess", async (s5) => {
            stageSkipped(s5, exitKind);
            return runStage("analytics.quality.compute", async (s6) => {
              s6.setAttribute("stage.skipped", true);
              s6.setAttribute("och.quality_precalculated", true);
              s6.setAttribute("och.quality_score", result.quality_score);
              s6.setAttribute("och.short_circuit", exitKind);
              return result;
            });
          });
        });
      });
    });
  });
}
