#!/usr/bin/env bash
# Curated data-flow-model.json → Graphviz DOT (Kafka + gRPC / HTTP topology).
# Optional: KAFKA_BROKER_STATUS_JSON=/path/to.json merges broker health (stable | election_heavy | flapping | unknown).
# Usage: ./build-data-flow-dot.sh [data-flow-model.json] [out.dot]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
THEME_FRAG="$REPO_ROOT/diagrams/theme.frag"
JQ_DIR="$SCRIPT_DIR/jq"
model="${1:-$SCRIPT_DIR/data/data-flow-model.json}"
dot_out="${2:?dot}"

command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

merged="$(mktemp)"
cleanup() { rm -f "$merged"; }
trap cleanup EXIT

status_file="${KAFKA_BROKER_STATUS_JSON:-}"
if [[ -n "$status_file" && -f "$status_file" ]]; then
  jq -s -f "$JQ_DIR/merge-kafka-broker-status.jq" "$model" "$status_file" >"$merged"
else
  jq -s -f "$JQ_DIR/merge-kafka-broker-status.jq" "$model" <(echo '{}') >"$merged"
fi

ttl="$(jq -r '.title // "Data flow"' "$merged")"
ttl="${ttl//\"/\\\"}"

{
  echo "digraph dataflow {"
  [[ -f "$THEME_FRAG" ]] && cat "$THEME_FRAG"
  echo "  graph [rankdir=LR, fontsize=11, label=\"${ttl}\", labelloc=t];"
  echo "  node [shape=box, style=rounded, fontname=\"Helvetica\"];"
  echo "  edge [fontname=\"Helvetica\", fontsize=9];"
  jq -r -f "$JQ_DIR/data-flow-to-dot.jq" "$merged"
  echo "}"
} >"$dot_out"
