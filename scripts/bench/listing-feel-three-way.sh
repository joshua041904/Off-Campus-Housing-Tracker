#!/usr/bin/env bash
# Compare three timings (cold vs warm = run twice each):
#   1) Local Ollama POST /api/generate
#   2) In-cluster Ollama (kubectl port-forward or in-VPC curl)
#   3) Edge POST /api/analytics/insights/listing-feel (needs JWT + x-user-id if gateway enforces)
#
# Usage:
#   MODEL=llama3.2:1b \
#   LOCAL_OLLAMA=http://127.0.0.1:11434 \
#   CLUSTER_OLLAMA=http://ollama.off-campus-housing-tracker.svc.cluster.local:11434 \
#   EDGE=https://off-campus-housing.test \
#   TOKEN='eyJ...' USER_ID='<jwt sub>' \
#   ./scripts/bench/listing-feel-three-way.sh
set -euo pipefail
MODEL="${MODEL:-llama3.2:1b}"
LOCAL_OLLAMA="${LOCAL_OLLAMA:-http://127.0.0.1:11434}"
CLUSTER_OLLAMA="${CLUSTER_OLLAMA:-}"
EDGE="${EDGE:-}"
TOKEN="${TOKEN:-}"
USER_ID="${USER_ID:-}"
PROMPT="${PROMPT:-Bench: one sentence summary of a 2BR student rental at \$1200/mo near campus.}"

json_body() {
  node -e '
    const p = process.env.PROMPT;
    console.log(JSON.stringify({
      model: process.env.MODEL,
      prompt: p,
      stream: false,
      options: { num_ctx: 1536, num_predict: 120, temperature: 0.3 }
    }));
  '
}

run_ollama() {
  local base="$1"
  local label="$2"
  echo "=== ${label} (${base}) ==="
  for i in 1 2; do
    echo -n "  run $i: "
    /usr/bin/env curl -sS -o /tmp/ollama-bench-out.json -w "http_code=%{http_code} time_namelookup=%{time_namelookup} time_connect=%{time_connect} time_starttransfer=%{time_starttransfer} time_total=%{time_total}\n" \
      -X POST "${base%/}/api/generate" \
      -H "Content-Type: application/json" \
      --data-binary "$(json_body)" || true
    wc -c /tmp/ollama-bench-out.json | awk '{print "  bytes:", $1}'
  done
}

run_listing_feel() {
  local edge="$1"
  if [[ -z "$TOKEN" || -z "$USER_ID" ]]; then
    echo "=== listing-feel (skipped: set TOKEN and USER_ID) ==="
    return 0
  fi
  echo "=== listing-feel (${edge}) ==="
  local body
  body=$(node -e "console.log(JSON.stringify({
    title: '2BR near campus',
    description: process.env.PROMPT || 'Quiet block.',
    price_cents: 120000,
    audience: 'renter',
    analysis_depth: 'quick'
  }))")
  for i in 1 2; do
    echo -n "  run $i: "
    /usr/bin/env curl -sS -o /tmp/lf-bench-out.json -w "http_code=%{http_code} time_namelookup=%{time_namelookup} time_connect=%{time_connect} time_starttransfer=%{time_starttransfer} time_total=%{time_total}\n" \
      -X POST "${edge%/}/api/analytics/insights/listing-feel" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "x-user-id: ${USER_ID}" \
      --data-binary "$body" || true
    wc -c /tmp/lf-bench-out.json | awk '{print "  bytes:", $1}'
  done
}

echo "MODEL=$MODEL num_ctx=1536 num_predict=120"
run_ollama "$LOCAL_OLLAMA" "local Ollama"
if [[ -n "$CLUSTER_OLLAMA" ]]; then
  run_ollama "$CLUSTER_OLLAMA" "cluster Ollama"
else
  echo "=== cluster Ollama (skipped: set CLUSTER_OLLAMA or port-forward URL) ==="
fi
if [[ -n "$EDGE" ]]; then
  run_listing_feel "$EDGE"
else
  echo "=== listing-feel (skipped: set EDGE=https://...) ==="
fi
