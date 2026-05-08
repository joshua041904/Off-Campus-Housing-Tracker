#!/usr/bin/env node
/**
 * Emit a minimal Grafana dashboard JSON (k6 + trace metrics) into bench_logs/.
 * Import manually in Grafana or wire to your provisioning pipeline.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const out = join(root, "bench_logs/k6_trace_dashboard.json");

const dashboard = {
  title: "K6 + trace correlation (generated)",
  uid: "och-k6-trace",
  schemaVersion: 39,
  version: 1,
  tags: ["k6", "tracing", "och"],
  timezone: "browser",
  panels: [
    {
      id: 1,
      title: "k6 http reqs / s",
      type: "timeseries",
      gridPos: { h: 8, w: 12, x: 0, y: 0 },
      targets: [{ expr: "sum(rate(k6_http_reqs_total[1m]))", refId: "A" }],
    },
    {
      id: 2,
      title: "k6 http req duration p95",
      type: "timeseries",
      gridPos: { h: 8, w: 12, x: 12, y: 0 },
      targets: [
        {
          expr: "histogram_quantile(0.95, sum(rate(k6_http_req_duration_bucket[5m])) by (le))",
          refId: "A",
        },
      ],
    },
    {
      id: 3,
      title: "Trace critical path (bench_logs/trace.prom)",
      type: "timeseries",
      gridPos: { h: 8, w: 12, x: 0, y: 8 },
      targets: [{ expr: "trace_critical_path_ms", refId: "A" }],
    },
    {
      id: 4,
      title: "Trace contract pass",
      type: "stat",
      gridPos: { h: 4, w: 6, x: 12, y: 8 },
      targets: [{ expr: "trace_contract_pass", refId: "A" }],
    },
    {
      id: 5,
      title: "Trace coverage (Prometheus textfile / remote write — tune to your scrape)",
      type: "timeseries",
      gridPos: { h: 8, w: 12, x: 0, y: 16 },
      targets: [{ expr: "trace_coverage_ratio", refId: "A" }],
    },
  ],
};

mkdirSync(join(root, "bench_logs"), { recursive: true });
writeFileSync(out, `${JSON.stringify(dashboard, null, 2)}\n`);
console.log(`✅ wrote ${out}`);
