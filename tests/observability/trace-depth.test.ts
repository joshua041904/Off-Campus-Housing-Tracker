import { describe, expect, it } from "vitest";
import { maxTraceDepth } from "../../scripts/trace-validators/lib/jaeger-max-trace-depth.mjs";

const MIN_DEPTH = Number(process.env.JAEGER_ANALYTICS_MIN_TRACE_DEPTH ?? "7");

function jaegerQueryBase(): string | undefined {
  const raw =
    process.env.JAEGER_QUERY_BASE?.trim() ||
    process.env.JAEGER_URL?.trim() ||
    "";
  if (!raw) return undefined;
  return raw.replace(/\/+$/u, "");
}

const jaegerBase = jaegerQueryBase();

type JaegerTraceWire = { traceID?: string; spans?: unknown[] };

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${url} → ${res.status} ${body.slice(0, 400)}`);
  }
  return res.json() as Promise<unknown>;
}

describe.skipIf(!jaegerBase)("Jaeger analytics trace depth", () => {
  it(`latest analytics-service traces have max CHILD_OF depth >= ${MIN_DEPTH}`, async () => {
    const base = jaegerBase!;

    const limit = Math.min(50, Number(process.env.JAEGER_TRACE_DEPTH_FETCH_LIMIT ?? "25"));
    const url = `${base}/api/traces?service=analytics-service&limit=${limit}`;
    const payload = (await fetchJson(url)) as {
      data?: JaegerTraceWire[];
      errors?: unknown;
    };

    if (payload.errors) {
      throw new Error(`Jaeger API errors: ${JSON.stringify(payload.errors)}`);
    }

    const traces = Array.isArray(payload.data) ? payload.data : [];
    expect(traces.length, `expected traces from ${url}`).toBeGreaterThan(0);

    let best = 0;
    let bestId = "";
    for (const t of traces) {
      const spans = Array.isArray(t.spans) ? t.spans : [];
      const d = maxTraceDepth(spans as Parameters<typeof maxTraceDepth>[0]);
      if (d > best) {
        best = d;
        bestId = String(t.traceID ?? "");
      }
    }

    expect(
      best,
      `max CHILD_OF depth across ${traces.length} traces (best traceID=${bestId})`,
    ).toBeGreaterThanOrEqual(MIN_DEPTH);
  });
});
