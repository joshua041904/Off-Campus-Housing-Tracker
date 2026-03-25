#!/usr/bin/env bash
# Read k6 --summary-export JSON files from run-k6-protocol-matrix.sh and write protocol-comparison.md
#
# Usage: ./scripts/perf/summarize-protocol-matrix.sh <protocol-matrix-dir>
set -euo pipefail

DIR="${1:?protocol-matrix directory required}"
[[ -d "$DIR" ]] || { echo "Not a directory: $DIR" >&2; exit 1; }

OUT="$DIR/protocol-comparison.md"

extract() {
  local file="$1"
  local label="$2"
  if [[ ! -f "$file" ]]; then
    echo "| $label | (no summary.json) | — | — | — | — |"
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    local med p90 p95 p99 max
    med=$(jq -r '.metrics["http_req_duration"].values.med // .metrics.http_req_duration.values.med // empty' "$file" 2>/dev/null || echo "")
    p90=$(jq -r '.metrics["http_req_duration"].values["p(90)"] // .metrics.http_req_duration.values["p(90)"] // empty' "$file" 2>/dev/null || echo "")
    p95=$(jq -r '.metrics["http_req_duration"].values["p(95)"] // .metrics.http_req_duration.values["p(95)"] // empty' "$file" 2>/dev/null || echo "")
    p99=$(jq -r '.metrics["http_req_duration"].values["p(99)"] // .metrics.http_req_duration.values["p(99)"] // empty' "$file" 2>/dev/null || echo "")
    max=$(jq -r '.metrics["http_req_duration"].values.max // .metrics.http_req_duration.values.max // empty' "$file" 2>/dev/null || echo "")
    [[ -z "$med" ]] && med=$(jq -r '.metrics["http_req_duration"].values.avg // empty' "$file" 2>/dev/null || echo "—")
    echo "| $label | ms | ${med:-—} | ${p90:-—} | ${p95:-—} | ${p99:-—} | ${max:-—} |"
  else
    echo "| $label | (install jq for columns) | | | | |"
  fi
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
  extract "$DIR/alpn/summary.json" "TLS ALPN (default k6)"
  extract "$DIR/http1/summary.json" "HTTP/1.1 (GODEBUG=http2client=0 — best effort)"
  extract "$DIR/http3/summary.json" "HTTP/3 (k6-http3 + k6/x/http3 if built)"
  echo ""
  echo "## Notes"
  echo ""
  echo "- **ALPN**: stock \`k6\` over \`https://\`; Caddy typically negotiates HTTP/2."
  echo "- **http1**: Go may still speak h2 depending on k6 build; treat as comparative hint only."
  echo "- **http3**: requires \`./scripts/build-k6-http3.sh\` → \`.k6-build/bin/k6-http3\`."
} >"$OUT"

echo "Wrote: $OUT"
