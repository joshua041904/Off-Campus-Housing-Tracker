#!/usr/bin/env bash
# Persist a replay payload for curl / trace-replay-runner.sh (JSON under bench_logs/trace_replay).
#
# Env (required unless defaults suffice):
#   TRACE_REPLAY_URL       — full URL (default: TRACE_REPLAY_URL_DEFAULT or none → error)
#   TRACE_REPLAY_METHOD    — GET (default)
#   TRACE_REPLAY_BODY      — optional raw body string
#   TRACE_REPLAY_HEADERS_JSON — JSON object of extra headers, e.g. '{"Authorization":"Bearer x"}'
#   TRACE_REPLAY_NOTE      — free-text note (k6 exit code, suite name, …)
#   TRACE_REPLAY_OUT_DIR   — output directory (default: $REPO_ROOT/bench_logs/trace_replay)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${TRACE_REPLAY_OUT_DIR:-$REPO_ROOT/bench_logs/trace_replay}"
mkdir -p "$OUT"
command -v jq >/dev/null 2>&1 || { echo "trace-replay-capture: jq required"; exit 1; }

url="${TRACE_REPLAY_URL:-}"
if [[ -z "$url" ]]; then
  echo "trace-replay-capture: set TRACE_REPLAY_URL" >&2
  exit 1
fi
method="${TRACE_REPLAY_METHOD:-GET}"
body="${TRACE_REPLAY_BODY:-}"
headers_json="${TRACE_REPLAY_HEADERS_JSON:-{}}"
note="${TRACE_REPLAY_NOTE:-}"
ts="$(date +%s)"
outfile="$OUT/trace-${ts}.json"

jq -n \
  --arg url "$url" \
  --arg method "$method" \
  --arg body "$body" \
  --argjson headers "$headers_json" \
  --arg note "$note" \
  '{url:$url,method:$method,body:$body,headers:$headers,note:$note,captured_at:(now|tostring)}' \
  >"$outfile"
echo "trace-replay-capture: wrote $outfile"
