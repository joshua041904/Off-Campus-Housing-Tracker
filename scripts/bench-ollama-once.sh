#!/usr/bin/env bash
# One-shot latency check against a running Ollama HTTP API (same surface analytics uses).
# Usage: OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_MODEL=llama3.2:1b ./scripts/bench-ollama-once.sh
set -euo pipefail
BASE="${OLLAMA_URL:-http://127.0.0.1:11434}"
BASE="${BASE%/}"
MODEL="${OLLAMA_MODEL:-llama3.2:1b}"
echo "GET $BASE/api/tags"
curl -sS -m 5 -o /dev/null -w "tags_wall_seconds=%{time_total}\n" "$BASE/api/tags" || echo "tags_failed"
BODY="$(jq -nc --arg m "$MODEL" '{model:$m,prompt:"Reply with exactly: OK",stream:false,options:{num_predict:12,num_ctx:512}}')"
echo "POST $BASE/api/generate (minimal num_predict)"
curl -sS -m 180 -X POST "$BASE/api/generate" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  -o /tmp/och-bench-ollama.json \
  -w "generate_wall_seconds=%{time_total}\n" || echo "generate_failed"
head -c 240 /tmp/och-bench-ollama.json 2>/dev/null || true
echo
