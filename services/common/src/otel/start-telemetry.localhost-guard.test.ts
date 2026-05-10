import { afterEach, describe, expect, it } from "vitest";
import { assertNoForbiddenLocalhostOtlpEnv, assertNoForbiddenLocalhostOtlpUrl } from "./start-telemetry.js";

describe("OTLP localhost guard", () => {
  const touched = new Set<string>();

  afterEach(() => {
    for (const k of touched) {
      delete process.env[k];
    }
    touched.clear();
  });

  function setEnv(key: string, value: string | undefined) {
    touched.add(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it("rejects OTEL_EXPORTER_OTLP_ENDPOINT with localhost when not in test mode", () => {
    setEnv("NODE_ENV", "development");
    setEnv("OCH_OTEL_LOCAL_JAEGER", undefined);
    setEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    expect(() => assertNoForbiddenLocalhostOtlpEnv()).toThrow(/OTEL_EXPORTER_OTLP_ENDPOINT/);
  });

  it("allows localhost when OCH_OTEL_LOCAL_JAEGER=1", () => {
    setEnv("NODE_ENV", "development");
    setEnv("OCH_OTEL_LOCAL_JAEGER", "1");
    setEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    expect(() => assertNoForbiddenLocalhostOtlpEnv()).not.toThrow();
  });

  it("allows localhost in NODE_ENV=test (Vitest)", () => {
    setEnv("NODE_ENV", "test");
    setEnv("OCH_OTEL_LOCAL_JAEGER", undefined);
    setEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318");
    expect(() => assertNoForbiddenLocalhostOtlpEnv()).not.toThrow();
  });

  it("rejects resolved traces URL on loopback without opt-in", () => {
    setEnv("NODE_ENV", "development");
    setEnv("OCH_OTEL_LOCAL_JAEGER", undefined);
    expect(() => assertNoForbiddenLocalhostOtlpUrl("http://127.0.0.1:4318/v1/traces")).toThrow(/OTLP traces URL/);
  });
});
