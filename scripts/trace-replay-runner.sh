#!/usr/bin/env bash
# Replay a JSON payload from trace-replay-capture.sh using curl (same method, URL, headers).
# Usage: bash scripts/trace-replay-runner.sh bench_logs/trace_replay/trace-1234567890.json
set -euo pipefail
file="${1:?usage: trace-replay-runner.sh <trace-....json>}"
command -v jq >/dev/null 2>&1 || { echo "trace-replay-runner: jq required"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "trace-replay-runner: curl required"; exit 1; }

url=$(jq -r '.url // empty' "$file")
method=$(jq -r '.method // "GET"' "$file")
[[ -n "$url" ]] || { echo "trace-replay-runner: missing url in $file"; exit 1; }

hdr_args=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  hdr_args+=(-H "$line")
done < <(jq -r '.headers // {} | to_entries[] | "\(.key): \(.value)"' "$file")

body=$(jq -r '.body // empty' "$file")
tmp=""
cleanup() { [[ -n "${tmp}" && -f "${tmp}" ]] && rm -f "${tmp}"; }
trap cleanup EXIT

if [[ -n "$body" ]]; then
  tmp="$(mktemp)"
  printf '%s' "$body" >"$tmp"
  curl -vk "${hdr_args[@]}" -X "$method" "$url" --data-binary @"$tmp"
else
  curl -vk "${hdr_args[@]}" -X "$method" "$url"
fi
