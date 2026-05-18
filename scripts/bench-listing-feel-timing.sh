#!/usr/bin/env bash
# Compare listing-feel latency: local Ollama vs in-cluster Ollama vs full deployed API.
# Usage:
#   LISTING_JSON='{"title":"t","description":"d","price_cents":50000,"audience":"renter","analysis_depth":"quick"}' \
#   ./scripts/bench-listing-feel-timing.sh
#
# Env:
#   LOCAL_OLLAMA_URL   default http://127.0.0.1:11434
#   CLUSTER_OLLAMA_URL default http://ollama.off-campus-housing-tracker.svc.cluster.local:11434
#   DEPLOYED_FEEL_URL  default https://off-campus-housing.test/api/analytics/insights/listing-feel
#   LISTING_JSON       POST body (required)
set -euo pipefail

LOCAL_OLLAMA_URL="${LOCAL_OLLAMA_URL:-http://127.0.0.1:11434}"
CLUSTER_OLLAMA_URL="${CLUSTER_OLLAMA_URL:-http://ollama.off-campus-housing-tracker.svc.cluster.local:11434}"
DEPLOYED_FEEL_URL="${DEPLOYED_FEEL_URL:-https://off-campus-housing.test/api/analytics/insights/listing-feel}"

BODY="${LISTING_JSON:-}"
if [[ -z "$BODY" ]]; then
  echo "Set LISTING_JSON to a JSON object matching listing-feel POST body." >&2
  exit 1
fi

MODEL="${OLLAMA_MODEL:-llama3.2:1b}"
PROMPT="Summarize in one sentence: rental listing title and price only."

echo "=== bench listing-feel path (same host prompt sanity) ==="
echo "Model hint: $MODEL"
echo

run_curl_table() {
  local name="$1"
  local url="$2"
  shift 2
  echo "--- $name ---"
  echo "URL: $url"
  curl -sS -o /tmp/bench-listing-feel-out.json -w "\
namelookup:    %{time_namelookup}s\n\
connect:      %{time_connect}s\n\
appconnect:   %{time_appconnect}s\n\
pretransfer:  %{time_pretransfer}s\n\
starttransfer:%{time_starttransfer}s\n\
total:        %{time_total}s\n\
http_code:    %{http_code}\n\
size_download:%{size_download} bytes\n" \
    "$@" || true
  if [[ -f /tmp/bench-listing-feel-out.json ]]; then
    echo "bytes(body): $(wc -c </tmp/bench-listing-feel-out.json)"
    head -c 240 /tmp/bench-listing-feel-out.json
    echo
  fi
  echo
}

echo "1) Direct Ollama /api/generate (local)"
run_curl_table "local_ollama_generate" "$LOCAL_OLLAMA_URL/api/generate" -X POST \
  -H "Content-Type: application/json" \
  -d "$(jq -nc --arg m "$MODEL" --arg p "$PROMPT" '{model:$m, prompt:$p, stream:false, options:{num_predict:32}}')"

echo "2) Direct Ollama /api/generate (in-cluster URL — only works from inside cluster or port-forward)"
run_curl_table "cluster_ollama_generate" "$CLUSTER_OLLAMA_URL/api/generate" -X POST \
  -H "Content-Type: application/json" \
  -d "$(jq -nc --arg m "$MODEL" --arg p "$PROMPT" '{model:$m, prompt:$p, stream:false, options:{num_predict:32}}')" || true

echo "3) Full deployed listing-feel (includes gateway + analytics + Ollama)"
run_curl_table "deployed_listing_feel" "$DEPLOYED_FEEL_URL" -X POST \
  -H "Content-Type: application/json" \
  -d "$BODY"

echo "Done. Interpret: if (1) is fast but (3) is slow, bottleneck is deployed path; compare listing_feel_timing in JSON body for server-side breakdown."
