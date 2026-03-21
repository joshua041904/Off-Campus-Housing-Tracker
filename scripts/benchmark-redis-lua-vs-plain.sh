#!/usr/bin/env bash
# Redis: Lua EVAL (incr-under-cap, one round-trip) vs plain GET + INCRBY + PEXPIRE (three round-trips).
# Writes CSV + HTML chart (Chart.js) under bench_logs/redis-lua-bench-*.
#
# Usage: ./scripts/benchmark-redis-lua-vs-plain.sh
#   BENCHMARK_OPS=50000 REDIS_PORT=6380
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

OUT="${REDIS_BENCH_OUT:-$REPO_ROOT/bench_logs/redis-lua-bench-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"

if ! nc -z 127.0.0.1 "${REDIS_PORT:-6380}" 2>/dev/null; then
  echo "⚠️  Redis not reachable on 127.0.0.1:${REDIS_PORT:-6380} — start: ./scripts/bring-up-external-infra.sh"
  exit 1
fi

if [[ ! -d "$REPO_ROOT/services/common/node_modules/ioredis" ]]; then
  echo "❌ Run pnpm install from repo root (need services/common/node_modules/ioredis)"
  exit 1
fi

JSON="$OUT/benchmark.json"
node "$SCRIPT_DIR/redis-benchmark-lua-vs-plain.cjs" >"$JSON"

python3 - "$OUT" "$JSON" <<'PY'
import json, pathlib, sys

out = pathlib.Path(sys.argv[1])
dec = json.loads(pathlib.Path(sys.argv[2]).read_text())

csv = out / "results.csv"
csv.write_text(
    "mode,duration_ms,ops,rps\n"
    f"lua,{dec['luaMs']:.2f},{dec['ops']},{dec['luaRps']:.2f}\n"
    f"plain,{dec['plainMs']:.2f},{dec['ops']},{dec['plainRps']:.2f}\n"
)

dec_js = json.dumps(dec)
html = out / "comparison-chart.html"
html.write_text(
    """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Redis Lua vs plain (incr-under-cap)</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f1419; color: #e6edf3; }
h1 { font-size: 1.25rem; }
p { color: #8b949e; max-width: 52rem; }
canvas { max-width: 720px; margin-top: 1.5rem; }
</style></head><body>
<h1>Redis: Lua (1× EVAL) vs plain (GET + INCRBY + PEXPIRE)</h1>
<p id="summary"></p>
<canvas id="c" height="120"></canvas>
<script>
const dec = """
    + dec_js
    + """;
document.getElementById("summary").innerHTML =
  `Ops=${dec.ops} · Lua ${dec.luaMs.toFixed(1)} ms (${dec.luaRps.toFixed(0)} ops/s) vs plain ${dec.plainMs.toFixed(1)} ms (${dec.plainRps.toFixed(0)} ops/s). <strong>~${dec.ratio.toFixed(2)}×</strong> wall-clock ratio (plain / lua). Same semantics as <code>services/common/src/redis-lua.ts</code>.`;
new Chart(document.getElementById("c"), {
  type: "bar",
  data: {
    labels: ["Lua EVAL (1 RTT/op)", "Plain (3 RTT/op)"],
    datasets: [{
      label: "Duration (ms)",
      data: [dec.luaMs, dec.plainMs],
      backgroundColor: ["#3fb950", "#d29922"],
    }],
  },
  options: {
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, grid: { color: "#30363d" } },
      x: { grid: { display: false } },
    },
  },
});
</script>
</body></html>
"""
)
print("Wrote", csv, "and", html)
PY

echo ""
echo "✅ Redis benchmark done → $OUT"
