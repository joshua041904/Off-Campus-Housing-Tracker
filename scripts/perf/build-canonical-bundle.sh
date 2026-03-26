#!/usr/bin/env bash
# Build the strict 10-file canonical perf artifact for one run directory.
#
# Usage (repo root):
#   ./scripts/perf/build-canonical-bundle.sh
#   ./scripts/perf/build-canonical-bundle.sh bench_logs/run-20260324-210538
#
# Env:
#   PREFLIGHT_RUN_DIR — same as first arg; default: newest bench_logs/run-*
#   SKIP_ZIP=1        — only create och-perf-canonical-10-v2 + summary.json
#   ALLOW_EMPTY_CANONICAL=1 — do not fail run on 0-byte files (default strict=0-byte fail)
#
# If telemetry-after.txt / raw-metrics.txt are missing at run root, attempts capture (kubectl) so
# strict canonical matches on-disk run artifacts. schema-report.md falls back to newest
# schema-report-*.md under the run dir, bench_logs/, or reports/.
#
# Output (under $RUN_DIR):
#   och-perf-canonical-10-v2/ — exactly 10 named files
#   summary.json              — manifest + sha256 per file
#   perf-bundle-<STAMP>.zip   — och-perf-canonical-10-v2/ + summary.json
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
OUT="$RUN_DIR/och-perf-canonical-10-v2"
mkdir -p "$OUT"

# telemetry-after / raw-metrics are often created only on preflight EXIT; refresh if missing so standalone
# bundle runs and strict validation match artifacts users see at run root.
_ensure_run_dir_metrics() {
  if [[ ! -f "$RUN_DIR/telemetry-after.txt" ]] || [[ ! -s "$RUN_DIR/telemetry-after.txt" ]]; then
    if [[ -f "$REPO_ROOT/scripts/capture-control-plane-telemetry.sh" ]]; then
      "$REPO_ROOT/scripts/capture-control-plane-telemetry.sh" --once >"$RUN_DIR/telemetry-after.txt" 2>&1 || true
    fi
  fi
  if [[ ! -f "$RUN_DIR/raw-metrics.txt" ]] || [[ ! -s "$RUN_DIR/raw-metrics.txt" ]]; then
    kubectl get --raw /metrics --request-timeout=15s >"$RUN_DIR/raw-metrics.txt" 2>/dev/null || echo "(raw metrics unavailable)" >"$RUN_DIR/raw-metrics.txt"
  fi
}
_ensure_run_dir_metrics

# Newest schema-report-*.md under run dir, bench_logs, or reports (inspect-external-db-schemas.sh timestamps the name).
_pick_schema_source() {
  local f best="" bt=0 t
  for f in "$RUN_DIR/schema-report.md" "$OUT/schema-report.md"; do
    [[ -f "$f" ]] || continue
    echo "$f"
    return 0
  done
  shopt -s nullglob
  local candidates=(
    "$RUN_DIR"/schema-report-*.md
    "$REPO_ROOT/bench_logs"/schema-report-*.md
    "$REPO_ROOT/reports"/schema-report-*.md
  )
  shopt -u nullglob
  for f in "${candidates[@]}"; do
    [[ -f "$f" ]] || continue
    t=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)
    if [[ "$t" -ge "$bt" ]]; then
      bt=$t
      best=$f
    fi
  done
  [[ -n "$best" ]] && echo "$best" && return 0
  return 1
}

_schema_src=""
if [[ -f "$RUN_DIR/schema-report.md" ]]; then
  _schema_src="$RUN_DIR/schema-report.md"
elif [[ -f "$OUT/schema-report.md" ]]; then
  _schema_src="$OUT/schema-report.md"
elif _pick=$( _pick_schema_source ); then
  _schema_src="$_pick"
fi

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
    echo "missing:$name"
    return 1
  fi
}

missing_count=0

_copy_first "latency-report.md" \
  "$RUN_DIR/phase-d/k6-cross-service-isolation/latency-report.md" \
  "$RUN_DIR/latency-report.md" || missing_count=$((missing_count + 1))

_copy_first "service-latency.csv" \
  "$RUN_DIR/latency/service-latency.csv" \
  "$RUN_DIR/service-latency.csv" || missing_count=$((missing_count + 1))

_copy_first "k6-suite-resources.log" "$RUN_DIR/k6-suite-resources.log" || missing_count=$((missing_count + 1))
_copy_first "telemetry-during.log" "$RUN_DIR/telemetry-during.log" || missing_count=$((missing_count + 1))
_copy_first "telemetry-after.txt" \
  "$RUN_DIR/telemetry-after.txt" \
  "$OUT/telemetry-after.txt" || missing_count=$((missing_count + 1))
_copy_first "raw-metrics.txt" \
  "$RUN_DIR/raw-metrics.txt" \
  "$OUT/raw-metrics.txt" || missing_count=$((missing_count + 1))

_copy_first "run-all-explain.log" \
  "$RUN_DIR/phase-d/run-all-explain.log" \
  "$RUN_DIR/run-all-explain.log" || missing_count=$((missing_count + 1))

if [[ -n "$_schema_src" ]]; then
  _copy_first "schema-report.md" "$_schema_src" "$RUN_DIR/schema-report.md" "$OUT/schema-report.md" || missing_count=$((missing_count + 1))
else
  _copy_first "schema-report.md" "$RUN_DIR/schema-report.md" "$OUT/schema-report.md" || missing_count=$((missing_count + 1))
fi

_copy_first "k6-cross-service-isolation.log" \
  "$RUN_DIR/k6-cross-service-isolation.log" \
  "$RUN_DIR/phase-d/k6-cross-service-isolation.log" \
  "$RUN_DIR/phase-d/k6-cross-service-isolation/k6-cross-service-isolation.log" || missing_count=$((missing_count + 1))

_copy_first "k6-dual-analytics-listings.log" \
  "$RUN_DIR/k6-dual-analytics-listings.log" \
  "$RUN_DIR/phase-d/k6-dual-analytics-listings.log" || missing_count=$((missing_count + 1))

SUMMARY="$RUN_DIR/summary.json"
python3 <<PY
import hashlib, json, os, time
from pathlib import Path

run_dir = Path("$RUN_DIR")
out_dir = run_dir / "och-perf-canonical-10-v2"
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
zero = []
for n in names:
    p = out_dir / n
    if p.is_file():
        data = p.read_bytes()
        h = hashlib.sha256(data).hexdigest()
        sz = len(data)
        files.append({"name": n, "bytes": sz, "sha256": h, "missing": False, "zero_bytes": sz == 0})
        if sz == 0:
            zero.append(n)
    else:
        files.append({"name": n, "bytes": 0, "sha256": None, "missing": True})
        missing.append(n)

doc = {
    "schema": "och-perf-canonical-10-v2",
    "run_dir": str(run_dir),
    "stamp": "$STAMP",
    "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "files": files,
    "missing_canonical_names": missing,
    "zero_byte_canonical_names": zero,
}
Path("$SUMMARY").write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
PY

echo ""
echo "Canonical file hashes:"
for f in latency-report.md service-latency.csv k6-cross-service-isolation.log k6-dual-analytics-listings.log \
         k6-suite-resources.log telemetry-during.log telemetry-after.txt run-all-explain.log raw-metrics.txt schema-report.md; do
  if [[ -f "$OUT/$f" ]]; then
    shasum -a 256 "$OUT/$f" | awk -v n="$f" '{printf "  %s  %s\n", $1, n}'
  else
    echo "  MISSING  $f"
  fi
done

zero_count=0
if [[ "${ALLOW_EMPTY_CANONICAL:-0}" != "1" ]]; then
  for f in latency-report.md service-latency.csv k6-cross-service-isolation.log k6-dual-analytics-listings.log \
           k6-suite-resources.log telemetry-during.log telemetry-after.txt run-all-explain.log raw-metrics.txt schema-report.md; do
    if [[ -f "$OUT/$f" ]]; then
      sz=$(wc -c <"$OUT/$f" | tr -d ' ')
      [[ "$sz" -eq 0 ]] && zero_count=$((zero_count + 1))
    fi
  done
fi

ZIP="$RUN_DIR/perf-bundle-${STAMP}.zip"
if [[ "$missing_count" -ne 0 ]] || [[ "$zero_count" -ne 0 ]]; then
  echo "Canonical completeness: FAIL"
  echo "  missing_files=$missing_count zero_byte_files=$zero_count"
  exit 2
fi

if [[ "${SKIP_ZIP:-0}" != "1" ]]; then
  (cd "$RUN_DIR" && zip -q -r "perf-bundle-${STAMP}.zip" "och-perf-canonical-10-v2" summary.json)
  echo "Wrote: $ZIP"
else
  echo "SKIP_ZIP=1 — no zip"
fi
echo "Wrote: $OUT/"
echo "Wrote: $SUMMARY"
echo "Canonical completeness: PASS"
