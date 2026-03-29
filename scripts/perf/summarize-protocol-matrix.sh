#!/usr/bin/env bash
# Read k6 per-protocol summaries from run-k6-protocol-matrix.sh and write reports.
#
# Usage: ./scripts/perf/summarize-protocol-matrix.sh <protocol-matrix-dir>
set -euo pipefail

DIR="${1:?protocol-matrix directory required}"
[[ -d "$DIR" ]] || { echo "Not a directory: $DIR" >&2; exit 1; }

OUT="$DIR/protocol-comparison.md"
CSV="$DIR/service-latency.csv"
RAW="$DIR/raw-metrics.txt"

metric() {
  local file="$1" expr="$2"
  jq -r "$expr // empty" "$file" 2>/dev/null || echo ""
}

# Prefer http_req_duration; xk6-http3 gateway summaries often expose http3_req_duration only.
dur_val() {
  local f="$1" key="$2"
  local v
  v=$(metric "$f" ".metrics[\"http_req_duration\"].values[\"$key\"] // .metrics[\"http_req_duration\"][\"$key\"] // empty")
  [[ -z "$v" || "$v" == "null" ]] && v=$(metric "$f" ".metrics[\"http3_req_duration\"].values[\"$key\"] // .metrics[\"http3_req_duration\"][\"$key\"] // empty")
  echo "$v"
}

extract_proto_rollup() {
  local proto="$1" label="$2"
  local file="$DIR/$proto/gateway-summary.json"
  if [[ ! -f "$file" ]]; then
    echo "| $label | ms | — | — | — | — | — |"
    return
  fi
  local med p90 p95 p99 max
  med=$(metric "$file" '.metrics["http_req_duration"].med // .metrics.http_req_duration.med // .metrics["http_req_duration"].values.med')
  p90=$(metric "$file" '.metrics["http_req_duration"]["p(90)"] // .metrics.http_req_duration["p(90)"] // .metrics["http_req_duration"].values["p(90)"]')
  p95=$(metric "$file" '.metrics["http_req_duration"]["p(95)"] // .metrics.http_req_duration["p(95)"] // .metrics["http_req_duration"].values["p(95)"]')
  p99=$(metric "$file" '.metrics["http_req_duration"]["p(99)"] // .metrics.http_req_duration["p(99)"] // .metrics["http_req_duration"].values["p(99)"]')
  max=$(metric "$file" '.metrics["http_req_duration"].max // .metrics.http_req_duration.max // .metrics["http_req_duration"].values.max')
  echo "| $label | ms | ${med:-—} | ${p90:-—} | ${p95:-—} | ${p99:-—} | ${max:-—} |"
}

{
  echo "# Protocol matrix — http_req_duration (k6 gateway health)"
  echo ""
  echo "Source directory: \`$DIR\`"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "| Mode | Unit | p50/med | p90 | p95 | p99 | max |"
  echo "|------|------|---------|-----|-----|-----|-----|"
  extract_proto_rollup "http2" "HTTP/2 (PROTOCOL_MODE=http2)"
  extract_proto_rollup "http1" "HTTP/1.1 (GODEBUG=http2client=0 — best effort)"
  extract_proto_rollup "http3" "HTTP/3 (xk6-http3: .k6-build/bin/k6-http3)"
  echo ""
  echo "## Notes"
  echo ""
  echo "- **ALPN**: stock \`k6\` over \`https://\`; Caddy typically negotiates HTTP/2."
  echo "- **http1**: Go may still speak h2 depending on k6 build; treat as comparative hint only."
  echo "- **http3**: xk6-http3 only — \`./scripts/build-k6-http3.sh\` (bandorko/xk6-http3); binary at \`.k6-build/bin/k6-http3\` or \`.k6-build/k6-http3\`. See \`docs/XK6_HTTP3_SETUP.md\`."
} >"$OUT"

{
  echo "service,protocol,p50,p95,p99,max,rps"
  for proto in http1 http2 http3; do
    for f in "$DIR/$proto/"*-summary.json; do
      [[ -f "$f" ]] || continue
      svc=$(basename "$f")
      svc=${svc%-summary.json}
      p50=$(dur_val "$f" "med")
      p95=$(dur_val "$f" "p(95)")
      p99=$(dur_val "$f" "p(99)")
      max=$(dur_val "$f" "max")
      rps=$(metric "$f" '.metrics.http_reqs.rate // .metrics["http_reqs"].rate // .metrics["http_reqs"].values.rate')
      [[ -z "$rps" || "$rps" == "null" ]] && rps=$(metric "$f" '.metrics.http3_reqs.rate // .metrics["http3_reqs"].rate // .metrics["http3_reqs"].values.rate')
      case "$proto" in
        http1) proto_csv="http1.1" ;;
        http2) proto_csv="http2" ;;
        http3) proto_csv="http3" ;;
      esac
      echo "$svc,$proto_csv,${p50:-},${p95:-},${p99:-},${max:-},${rps:-}"
    done
  done
} >"$CSV"

{
  echo "# raw k6 summary exports (concatenated)"
  for p in http1 http2 http3; do
    for f in "$DIR/$p/"*-summary.json; do
      [[ -f "$f" ]] || continue
      echo ""
      echo "### protocol=$p file=$f"
      cat "$f"
    done
  done
} >"$RAW"

echo "Wrote: $OUT"
echo "Wrote: $CSV"
echo "Wrote: $RAW"
