#!/usr/bin/env bash
# Build the 10-file canonical perf artifact + summary.json + zip for one preflight run directory.
#
# Usage (repo root):
#   ./scripts/perf/build-canonical-bundle.sh
#   ./scripts/perf/build-canonical-bundle.sh bench_logs/run-20260324-210538
#
# Env:
#   PREFLIGHT_RUN_DIR — same as first arg; default: newest bench_logs/run-*
#   SKIP_ZIP=1        — only create PERF_CANONICAL_10 + summary.json
#
# Output (under $RUN_DIR):
#   PERF_CANONICAL_10/        — exactly 10 named files (or *.MISSING placeholders)
#   summary.json              — manifest + sha256 per file
#   perf-bundle-<STAMP>.zip   — PERF_CANONICAL_10/ + summary.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

RUN_DIR="${1:-${PREFLIGHT_RUN_DIR:-}}"
if [[ -z "$RUN_DIR" ]]; then
  RUN_DIR=$(ls -td "$REPO_ROOT"/bench_logs/run-* 2>/dev/null | head -1 || true)
fi
[[ -n "$RUN_DIR" ]] && [[ -d "$RUN_DIR" ]] || {
  echo "Usage: $0 [bench_logs/run-<STAMP>] or set PREFLIGHT_RUN_DIR" >&2
  exit 1
}

RUN_DIR="$(cd "$RUN_DIR" && pwd)"
STAMP=$(basename "$RUN_DIR" | sed 's/^run-//')
OUT="$RUN_DIR/PERF_CANONICAL_10"
mkdir -p "$OUT"

# $1 canonical name, $2... candidate paths (first existing wins)
_copy_first() {
  local name="$1"
  shift
  local src=""
  for p in "$@"; do
    [[ -n "$p" ]] && [[ -e "$p" ]] || continue
    src="$p"
    break
  done
  if [[ -n "$src" ]]; then
    cp -f "$src" "$OUT/$name"
    echo "ok:$name"
  else
    echo "Canonical perf: missing source for $name (tried: $*)" >"$OUT/$name.MISSING"
    echo "missing:$name"
  fi
}

_copy_first "latency-report.md" \
  "$RUN_DIR/phase-d/k6-cross-service-isolation/latency-report.md" \
  "$RUN_DIR/latency-report.md"

_copy_first "service-latency.csv" \
  "$RUN_DIR/latency/service-latency.csv" \
  "$RUN_DIR/service-latency.csv"

_copy_first "k6-suite-resources.log" "$RUN_DIR/k6-suite-resources.log"
_copy_first "telemetry-during.log" "$RUN_DIR/telemetry-during.log"
_copy_first "telemetry-after.txt" "$RUN_DIR/telemetry-after.txt"
_copy_first "raw-metrics.txt" "$RUN_DIR/raw-metrics.txt"

_copy_first "run-all-explain.log" \
  "$RUN_DIR/phase-d/run-all-explain.log" \
  "$RUN_DIR/run-all-explain.log"

_copy_first "schema-report.md" "$RUN_DIR/schema-report.md"

_copy_first "k6-cross-service-isolation.log" \
  "$RUN_DIR/phase-d/k6-cross-service-isolation.log" \
  "$RUN_DIR/phase-d/k6-cross-service-isolation/k6-cross-service-isolation.log"

_copy_first "k6-dual-analytics-listings.log" \
  "$RUN_DIR/phase-d/k6-dual-analytics-listings.log"

SUMMARY="$RUN_DIR/summary.json"
python3 <<PY
import hashlib, json, os, time
from pathlib import Path

run_dir = Path("$RUN_DIR")
out_dir = run_dir / "PERF_CANONICAL_10"
names = [
  "latency-report.md",
  "service-latency.csv",
  "k6-suite-resources.log",
  "telemetry-during.log",
  "telemetry-after.txt",
  "raw-metrics.txt",
  "run-all-explain.log",
  "schema-report.md",
  "k6-cross-service-isolation.log",
  "k6-dual-analytics-listings.log",
]
files = []
missing = []
for n in names:
    p = out_dir / n
    miss = out_dir / (n + ".MISSING")
    if p.is_file():
        data = p.read_bytes()
        h = hashlib.sha256(data).hexdigest()
        files.append({"name": n, "bytes": len(data), "sha256": h, "missing": False})
    elif miss.is_file():
        files.append({"name": n, "bytes": 0, "sha256": None, "missing": True})
        missing.append(n)
    else:
        files.append({"name": n, "bytes": 0, "sha256": None, "missing": True})
        missing.append(n)

doc = {
    "schema": "och-perf-canonical-10-v1",
    "run_dir": str(run_dir),
    "stamp": "$STAMP",
    "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "files": files,
    "missing_canonical_names": missing,
}
Path("$SUMMARY").write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
PY

ZIP="$RUN_DIR/perf-bundle-${STAMP}.zip"
if [[ "${SKIP_ZIP:-0}" != "1" ]]; then
  (cd "$RUN_DIR" && zip -q -r "perf-bundle-${STAMP}.zip" PERF_CANONICAL_10 summary.json)
  echo "Wrote: $ZIP"
else
  echo "SKIP_ZIP=1 — no zip"
fi
echo "Wrote: $OUT/"
echo "Wrote: $SUMMARY"
