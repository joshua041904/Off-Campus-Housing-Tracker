#!/usr/bin/env bash
# Emit bench_logs/bootstrap_phase_metrics.prom from bootstrap_phase_timings.json (Prometheus text exposition).
# Env: VERIFY_BOOTSTRAP_TIMING_JSON, VERIFY_BOOTSTRAP_PROM_OUT — override paths.
# Env: OCH_INFRA_HEALED=1 — increment bench_logs/infra_heal_count.txt (C.infra Colima wedged-profile heal).
# Env: VERIFY_BOOTSTRAP_INFRA_HEAL_COUNT — override path to infra_heal_count.txt
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMING="${VERIFY_BOOTSTRAP_TIMING_JSON:-$ROOT/bench_logs/bootstrap_phase_timings.json}"
OUT="${VERIFY_BOOTSTRAP_PROM_OUT:-$ROOT/bench_logs/bootstrap_phase_metrics.prom}"
GRAPH="${VERIFY_BOOTSTRAP_GRAPH:-$ROOT/infra/bootstrap_invariants.graph.json}"
INFRA_HEAL_COUNT_FILE="${VERIFY_BOOTSTRAP_INFRA_HEAL_COUNT:-$ROOT/bench_logs/infra_heal_count.txt}"

mkdir -p "$(dirname "$OUT")"
OUT_TMP="${OUT}.tmp.$$"
export OUT_TMP
trap 'rm -f "$OUT_TMP"' EXIT

TIMING="$TIMING" OUT_TMP="$OUT_TMP" GRAPH="$GRAPH" python3 <<'PY'
import json, os, re

timing_path = os.environ["TIMING"]
out_path = os.environ["OUT_TMP"]
graph_path = os.environ.get("GRAPH", "")
safe_label = re.compile(r"^[A-Za-z0-9_.-]+$")

try:
    with open(timing_path, encoding="utf-8") as fh:
        data = json.load(fh)
except FileNotFoundError:
    data = {}
if not isinstance(data, dict):
    data = {}

lines = [
    "# HELP bootstrap_phase_duration_ms Wall-clock duration of the last recorded bootstrap slice per DAG node (milliseconds).",
    "# TYPE bootstrap_phase_duration_ms gauge",
]
pairs = []
for k, v in data.items():
    if not isinstance(k, str) or not isinstance(v, (int, float)):
        continue
    if not safe_label.match(k):
        continue
    ms = int(v)
    esc = k.replace("\\", "\\\\").replace('"', '\\"')
    lines.append(f'bootstrap_phase_duration_ms{{phase="{esc}"}} {ms}')
    pairs.append((k, ms))

# Longest weighted path in the invariant DAG (sum of phase ms on chain) + chain length (nodes).
lines.append(
    "# HELP bootstrap_critical_path_ms Sum of phase durations (ms) along the longest weighted path in the invariant DAG (current timings snapshot)."
)
lines.append("# TYPE bootstrap_critical_path_ms gauge")
lines.append(
    "# HELP bootstrap_critical_path_length_nodes Number of DAG nodes on that longest-weight path (includes dependencies)."
)
lines.append("# TYPE bootstrap_critical_path_length_nodes gauge")
lines.append(
    "# HELP bootstrap_critical_path_phase_info Gauge=1 on the tip phase of the longest-weight path (same snapshot)."
)
lines.append("# TYPE bootstrap_critical_path_phase_info gauge")

cp_sum = 0
cp_len = 0
cp_tip = ""
if pairs:
    k_bottle, v_bottle = max(pairs, key=lambda x: x[1])
    cp_sum = int(v_bottle)
    cp_len = 1
    cp_tip = k_bottle
    try:
        with open(graph_path, encoding="utf-8") as gf:
            g = json.load(gf)
        nodes = list((g.get("nodes") or {}).keys())
        edges = g.get("edges") or []
        preds = {n: [] for n in nodes}
        adj = {n: [] for n in nodes}
        for edge in edges:
            if not isinstance(edge, (list, tuple)) or len(edge) < 2:
                continue
            u, v = edge[0], edge[1]
            if u in preds and v in preds:
                preds[v].append(u)
                adj[u].append(v)
        indeg = {n: 0 for n in nodes}
        for u, vs in adj.items():
            for v in vs:
                indeg[v] += 1
        q = sorted([n for n in nodes if indeg[n] == 0])
        topo = []
        while q:
            u = q.pop(0)
            topo.append(u)
            for v in adj[u]:
                indeg[v] -= 1
                if indeg[v] == 0:
                    q.append(v)
                    q.sort()
        if len(topo) != len(nodes):
            raise RuntimeError("cycle or incomplete topo")
        weights = {}
        for n in nodes:
            raw = data.get(n)
            if isinstance(raw, (int, float)):
                weights[n] = float(raw)
            else:
                weights[n] = 0.0
        dist = {}
        back = {}
        for n in topo:
            wn = weights.get(n, 0.0)
            ps = preds.get(n) or []
            if not ps:
                dist[n] = wn
                back[n] = None
            else:
                best = -1.0
                bestp = None
                for p in ps:
                    cand = dist.get(p, 0.0) + wn
                    if cand > best or (cand == best and (bestp is None or p < bestp)):
                        best = cand
                        bestp = p
                dist[n] = best
                back[n] = bestp
        tip = max(nodes, key=lambda x: (dist.get(x, 0.0), x))
        cp_sum = int(round(dist.get(tip, 0.0)))
        chain = []
        cur = tip
        seen = set()
        while cur is not None and cur not in seen:
            chain.append(cur)
            seen.add(cur)
            cur = back.get(cur)
        cp_len = len(chain)
        cp_tip = tip
    except Exception:
        cp_sum = int(v_bottle)
        cp_len = 1
        cp_tip = k_bottle

if cp_tip:
    esc = cp_tip.replace("\\", "\\\\").replace('"', '\\"')
    lines.append(f"bootstrap_critical_path_ms {cp_sum}")
    lines.append(f"bootstrap_critical_path_length_nodes {cp_len}")
    lines.append(f'bootstrap_critical_path_phase_info{{phase="{esc}"}} 1')
else:
    lines.append("bootstrap_critical_path_ms 0")
    lines.append("bootstrap_critical_path_length_nodes 0")

with open(out_path, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines) + "\n")
PY

mkdir -p "$(dirname "$INFRA_HEAL_COUNT_FILE")"
if [[ "${OCH_INFRA_HEALED:-0}" == "1" ]]; then
  _c=0
  if [[ -f "$INFRA_HEAL_COUNT_FILE" ]] && [[ -s "$INFRA_HEAL_COUNT_FILE" ]]; then
    _raw="$(tr -d ' \n\r\t' < "$INFRA_HEAL_COUNT_FILE" | head -c 24)"
    [[ "$_raw" =~ ^[0-9]+$ ]] && _c="$_raw"
  fi
  echo $((_c + 1)) > "$INFRA_HEAL_COUNT_FILE"
fi

_cnt=0
if [[ -f "$INFRA_HEAL_COUNT_FILE" ]] && [[ -s "$INFRA_HEAL_COUNT_FILE" ]]; then
  _raw="$(tr -d ' \n\r\t' < "$INFRA_HEAL_COUNT_FILE" | head -c 24)"
  [[ "$_raw" =~ ^[0-9]+$ ]] && _cnt="$_raw"
fi

{
  cat "$OUT_TMP"
  echo ""
  echo "# HELP bootstrap_infra_self_heal_count Times Colima wedged-profile auto-heal ran (C.infra cold guarantee)."
  echo "# TYPE bootstrap_infra_self_heal_count counter"
  echo "bootstrap_infra_self_heal_count ${_cnt}"
} > "$OUT"
trap - EXIT
rm -f "$OUT_TMP"

echo "$OUT"
