#!/usr/bin/env bash
# Curated domain-model.json → Graphviz DOT (logical cross-service view).
# Usage: ./build-domain-dot.sh [domain-model.json] [out.dot]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
THEME_FRAG="$REPO_ROOT/diagrams/theme.frag"
model="${1:-$SCRIPT_DIR/data/domain-model.json}"
dot_out="${2:?out.dot}"
JQ_DIR="$SCRIPT_DIR/jq"

command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

ttl="$(jq -r '.title // "Domain model"' "$model")"
ttl="${ttl//\"/\\\"}"

{
  echo "digraph domain {"
  [[ -f "$THEME_FRAG" ]] && cat "$THEME_FRAG"
  echo "  graph [rankdir=LR, fontsize=11, label=\"${ttl}\", labelloc=t];"
  echo "  node [shape=box, style=rounded, fontname=\"Helvetica\"];"
  echo "  edge [fontname=\"Helvetica\", fontsize=9];"
  jq -r -f "$JQ_DIR/domain-edges.jq" "$model"
  jq -r -f "$JQ_DIR/domain-async.jq" "$model"
  echo "}"
} >"$dot_out"
