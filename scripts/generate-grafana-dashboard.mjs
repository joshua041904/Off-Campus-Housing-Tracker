#!/usr/bin/env node
/**
 * Emit a Grafana dashboard JSON for bootstrap / app-runtime / regression textfile metrics.
 * Reads optional .prom files under bench_logs/ to list discovered metric families in a text panel.
 *
 * Out: bench_logs/bootstrap_grafana_dashboard.json (override: BOOTSTRAP_GRAFANA_DASHBOARD_OUT)
 *
 * Prometheus datasource: panels use ${DS_PROMETHEUS} — set dashboard variable or replace uid after import.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const outPath =
  process.env.BOOTSTRAP_GRAFANA_DASHBOARD_OUT || join(repoRoot, "bench_logs/bootstrap_grafana_dashboard.json");
const benchLogs = join(repoRoot, "bench_logs");

function scanPromMetrics() {
  const lines = [];
  if (!existsSync(benchLogs)) return lines;
  for (const name of readdirSync(benchLogs)) {
    if (!name.endsWith(".prom")) continue;
    const p = join(benchLogs, name);
    let text;
    try {
      text = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    const metrics = new Set();
    for (const line of text.split("\n")) {
      const m = line.match(/^#\s+HELP\s+(\S+)/);
      if (m) metrics.add(m[1]);
    }
    if (metrics.size) lines.push(`${name}: ${[...metrics].sort().join(", ")}`);
  }
  return lines;
}

const ds = { type: "prometheus", uid: "${DS_PROMETHEUS}" };

function panelStat(id, title, expr, grid) {
  return {
    id,
    type: "stat",
    title,
    datasource: ds,
    gridPos: grid,
    fieldConfig: {
      defaults: {
        color: { mode: "thresholds" },
        thresholds: {
          mode: "absolute",
          steps: [
            { color: "blue", value: null },
            { color: "green", value: 0 },
          ],
        },
      },
      overrides: [],
    },
    options: {
      colorMode: "value",
      graphMode: "area",
      justifyMode: "auto",
      orientation: "horizontal",
      reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false },
      textMode: "auto",
    },
    targets: [{ datasource: ds, expr, refId: "A" }],
  };
}

function panelTimeseries(id, title, exprs, grid, unit = "ms") {
  return {
    id,
    type: "timeseries",
    title,
    datasource: ds,
    gridPos: grid,
    fieldConfig: {
      defaults: {
        color: { mode: "palette-classic" },
        custom: { drawStyle: "line", fillOpacity: 15, lineWidth: 2 },
        unit,
      },
      overrides: [],
    },
    options: { legend: { displayMode: "list", placement: "bottom" } },
    targets: exprs.map((expr, i) => ({
      datasource: ds,
      expr,
      legendFormat: expr.includes("quantile") ? "{{quantile}}" : "{{phase}}",
      refId: String.fromCharCode(65 + i),
    })),
  };
}

function main() {
  const discovered = scanPromMetrics();
  const discoveryText =
    discovered.length > 0
      ? "**bench_logs \\*.prom (HELP lines)**\\n\\n" + discovered.join("\\n")
      : "No `*.prom` files found under bench_logs/ yet. Run verify-app-runtime / export scripts, then re-generate.";

  const dashboard = {
    id: null,
    uid: "och-bootstrap-observability",
    title: "OCH — Bootstrap observability",
    tags: ["och", "bootstrap", "record-platform"],
    schemaVersion: 39,
    version: 1,
    refresh: "30s",
    time: { from: "now-24h", to: "now" },
    timezone: "browser",
    editable: true,
    graphTooltip: 1,
    templating: {
      list: [
        {
          name: "DS_PROMETHEUS",
          label: "Prometheus",
          type: "datasource",
          query: "prometheus",
          refresh: 1,
          regex: "",
          hide: 0,
          current: { selected: true, text: "Prometheus", value: "prometheus" },
          options: [],
        },
      ],
    },
    panels: [
      {
        id: 1,
        type: "text",
        title: "Metric discovery (local textfiles)",
        gridPos: { h: 5, w: 24, x: 0, y: 0 },
        options: { content: discoveryText, mode: "markdown" },
      },
      panelStat(2, "Bootstrap regression count", "bootstrap_regression_count", { h: 4, w: 6, x: 0, y: 5 }),
      panelStat(3, "Bootstrap regression OK (1=yes)", "bootstrap_regression_ok", { h: 4, w: 6, x: 6, y: 5 }),
      panelStat(4, "Critical path (ms)", "bootstrap_critical_path_ms", { h: 4, w: 6, x: 12, y: 5 }),
      panelStat(11, "Critical path length (nodes)", "bootstrap_critical_path_length_nodes", { h: 4, w: 6, x: 0, y: 9 }),
      panelStat(5, "Regression vs p95 (max ratio)", "max(bootstrap_regression_phase_ratio)", {
        h: 4,
        w: 6,
        x: 18,
        y: 5,
      }),
      panelTimeseries(
        6,
        "App runtime — latency percentiles (ms)",
        ['app_runtime_latency_percentile_ms{quantile="0.50"}', 'app_runtime_latency_percentile_ms{quantile="0.95"}'],
        { h: 8, w: 12, x: 0, y: 13 }
      ),
      panelTimeseries(
        7,
        "App runtime — per-service latency (ms)",
        ["app_runtime_latency_ms"],
        { h: 8, w: 12, x: 12, y: 13 }
      ),
      panelTimeseries(
        8,
        "Bootstrap phase duration (ms)",
        ["bootstrap_phase_duration_ms"],
        { h: 8, w: 12, x: 0, y: 21 }
      ),
      panelTimeseries(
        9,
        "Bootstrap regression phase ratio",
        ["bootstrap_regression_phase_ratio"],
        { h: 8, w: 12, x: 12, y: 21 }
      ),
      panelTimeseries(
        10,
        "App runtime — run latency histogram (_bucket)",
        ["app_runtime_run_latency_distribution_seconds_bucket"],
        { h: 8, w: 24, x: 0, y: 29 },
        "short"
      ),
      panelStat(20, "App runtime — DAG critical path (ms)", "app_runtime_critical_path_ms", { h: 4, w: 6, x: 0, y: 37 }),
      panelTimeseries(
        21,
        "App runtime — DAG critical path (ms)",
        ["app_runtime_critical_path_ms"],
        { h: 7, w: 9, x: 6, y: 37 }
      ),
      panelTimeseries(
        22,
        "App runtime — per-service wall + dependency edges (ms)",
        ["app_runtime_latency_ms", "app_runtime_dependency_latency_ms"],
        { h: 7, w: 9, x: 15, y: 37 }
      ),
      panelTimeseries(
        23,
        "App runtime — critical-path sum per service (ms)",
        ["app_runtime_service_critical_path_ms"],
        { h: 7, w: 24, x: 0, y: 44 }
      ),
    ],
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(dashboard, null, 2), "utf8");
  console.log(outPath);
}

main();
