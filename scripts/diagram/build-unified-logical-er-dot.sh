#!/usr/bin/env bash
# Curated unified-logical-er.json → Graphviz DOT (system-level logical ER).
# Usage: ./build-unified-logical-er-dot.sh [unified-logical-er.json] [out.dot]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
THEME_FRAG="$REPO_ROOT/diagrams/theme.frag"
JQ_DIR="$SCRIPT_DIR/jq"

model="${1:-$SCRIPT_DIR/data/unified-logical-er.json}"
dot_out="${2:?out.dot}"

command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

ttl="$(jq -r '.title // "Unified logical ER"' "$model")"
sub="$(jq -r '.subtitle // ""' "$model")"
lbl="$ttl"
[[ -n "$sub" ]] && lbl="$ttl\\n$sub"
lbl="${lbl//\"/\\\"}"

{
  echo "digraph unified_logical_er {"
  [[ -f "$THEME_FRAG" ]] && cat "$THEME_FRAG"
  echo "  graph [rankdir=LR, fontsize=10, label=\"${lbl}\", labelloc=t];"
  echo "  node [fontname=\"Helvetica\"];"
  echo "  edge [fontname=\"Helvetica\", fontsize=8];"
  echo ""
  jq -r -f "$JQ_DIR/unified-logical-to-dot.jq" "$model"
  echo "}"
} >"$dot_out"
