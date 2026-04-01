#!/usr/bin/env bash
# JSON (from export-schema.sh) → Graphviz DOT (clustered by schema, optional heat overlay).
# Usage: ./generate-physical-dot.sh <schema.json> <out.dot> [graph_title] [table_stats.json]
# If table_stats.json is provided (or PHYSICAL_HEAT=1 and <schema>.stats.json exists beside schema), merges pg_stat_user_tables for fillcolor.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
THEME_FRAG="$REPO_ROOT/diagrams/theme.frag"
JQ_DIR="$SCRIPT_DIR/jq"

json="${1:?json}"
dot_out="${2:?dot}"
title="${3:-Physical schema}"
stats_arg="${4:-}"

command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

jq -e '.tables | type == "array"' "$json" >/dev/null

merged="$(mktemp)"
cleanup() { rm -f "$merged"; }
trap cleanup EXIT

if [[ -n "$stats_arg" && -f "$stats_arg" ]]; then
  jq -s '.[0] * {table_stats: (.[1].table_stats // [])}' "$json" "$stats_arg" >"$merged"
elif [[ "${PHYSICAL_HEAT:-}" == "1" ]]; then
  stats_sidecar="${json%.json}.stats.json"
  if [[ -f "$stats_sidecar" ]]; then
    jq -s '.[0] * {table_stats: (.[1].table_stats // [])}' "$json" "$stats_sidecar" >"$merged"
  else
    jq '. + {table_stats: []}' "$json" >"$merged"
  fi
else
  jq '. + {table_stats: []}' "$json" >"$merged"
fi

title="${title//\"/\\\"}"
{
  echo "digraph physical {"
  if [[ -f "$THEME_FRAG" ]]; then
    cat "$THEME_FRAG"
  fi
  echo "  graph [rankdir=LR, fontsize=11, label=\"${title}\", labelloc=t];"
  echo "  node [shape=record, fontname=\"Helvetica\"];"
  echo "  edge [fontname=\"Helvetica\", fontsize=8];"
  echo ""
  jq -r -f "$JQ_DIR/physical-body.jq" "$merged"
  echo "}"
} >"$dot_out"
