import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { propagation, context, trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildKafkaMessageHeaders, extractKafkaMessageContext } from "./kafka-propagation.js";

describe("kafka propagation", () => {
  const exporter = new InMemorySpanExporter();
  let provider: BasicTracerProvider;

  beforeEach(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    provider = new BasicTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
  });

  it("inject then extract keeps the same trace id for child span", () => {
    const tracer = trace.getTracer("test");
    const root = tracer.startSpan("producer");
    const ctx = trace.setSpan(context.active(), root);

    const headers = context.with(ctx, () => buildKafkaMessageHeaders());
    const extracted = extractKafkaMessageContext(headers);
    const rootTraceId = root.spanContext().traceId;

    let childTraceId = "";
    context.with(extracted, () => {
      const child = tracer.startSpan("consumer");
      childTraceId = child.spanContext().traceId;
      child.end();
    });
    root.end();

    expect(childTraceId).toBe(rootTraceId);
    expect(childTraceId.length).toBe(32);
  });
});
