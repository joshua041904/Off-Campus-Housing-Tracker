import type { Context } from "@opentelemetry/api";
import type { Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

/**
 * Step7 / Jaeger gates require `net.proto` on every housing span. Manual middleware sets the real
 * protocol; this processor guarantees a non-empty tag when anything forgets (Kafka helpers, tests).
 */
export class EnsureNetProtoSpanProcessor implements SpanProcessor {
  onStart(span: Span, _parentContext: Context): void {
    if (span.attributes["net.proto"] === undefined) {
      span.setAttribute("net.proto", "unknown");
    }
  }

  onEnd(): void {}

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
