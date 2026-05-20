#!/usr/bin/env bash
# Hit core /metrics endpoints so Grafana panels that use http_requests_total, process_*, etc. have fresh samples.
# Run from a host that resolves OCH edge (default https://off-campus-housing.test) or set METRICS_BASE_URLS (space-separated).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -n "${METRICS_BASE_URLS:-}" ]]; then
  read -r -a URLS <<<"${METRICS_BASE_URLS}"
else
  EDGE="${OCH_EDGE_BASE_URL:-https://off-campus-housing.test}"
  URLS=(
    "${EDGE}/api/healthz"
    "${EDGE}/metrics"
  )
fi

curl_common=(curl -fsS --connect-timeout 5 --max-time 15)
if [[ "${OCH_INSECURE_TLS:-}" == "1" ]]; then
  curl_common+=(--insecure)
fi

for u in "${URLS[@]}"; do
  echo "→ GET $u"
  "${curl_common[@]}" "$u" >/dev/null || echo "  (warn: non-zero exit for $u — check TLS / edge)"
done

echo "✅ Warm-up GETs done. Prometheus scrapes housing static jobs every 15s; allow ~30s before refreshing Grafana."
