#!/usr/bin/env bash
# Export all OCH external DBs → JSON + physical DOT + SVG; PNGs → data-modeling/png/ (single folder).
# Requires: psql, jq, dot (Graphviz).
#
# Usage: ./scripts/diagram/generate-all.sh [output_root]
#   output_root defaults to repo diagrams/
# Env: PGHOST PGUSER PGPASSWORD, INSPECT_DBS
#   PHYSICAL_HEAT=0 — skip pg_stat merge (tables stay neutral gray-green).
#   KAFKA_BROKER_STATUS_JSON — optional path; merges broker health for data-flow diagram.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT="${1:-$REPO_ROOT/diagrams}"
PNG_ROOT="$OUT/data-modeling/png"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"

if [[ -z "${INSPECT_DBS:-}" ]]; then
  INSPECT_DBS="5441:auth:auth
5442:listings:listings
5443:bookings:bookings
5444:messaging:messaging
5445:notification:notification
5446:trust:trust
5447:analytics:analytics
5448:media:media"
fi
if [[ -f "${INSPECT_DBS:-}" ]]; then
  DB_LIST="$(cat "$INSPECT_DBS")"
else
  DB_LIST="$INSPECT_DBS"
fi

command -v jq >/dev/null || { echo "jq required (brew install jq / apt install jq)" >&2; exit 1; }
command -v dot >/dev/null || { echo "Graphviz dot required (brew install graphviz / apt install graphviz)" >&2; exit 1; }

mkdir -p "$OUT/physical/json" "$OUT/physical" "$OUT/domain" "$OUT/flow" "$OUT/poster" "$PNG_ROOT"

echo "=== Unified logical ER (system-level, curated) ==="
"$SCRIPT_DIR/build-unified-logical-er-dot.sh" "$SCRIPT_DIR/data/unified-logical-er.json" "$OUT/domain/unified-logical-er.dot"
DOT_DPI="${UNIFIED_ER_DPI:-160}" "$SCRIPT_DIR/render.sh" "$OUT/domain/unified-logical-er.dot" "$OUT/domain/unified-logical-er.svg" "$PNG_ROOT/unified-logical-er.png"
echo "  → $OUT/domain/unified-logical-er.svg + $PNG_ROOT/unified-logical-er.png"

echo "=== Domain (curated) ==="
"$SCRIPT_DIR/build-domain-dot.sh" "$SCRIPT_DIR/data/domain-model.json" "$OUT/domain/domain.dot"
"$SCRIPT_DIR/render.sh" "$OUT/domain/domain.dot" "$OUT/domain/domain.svg" "$PNG_ROOT/domain.png"
echo "  → $OUT/domain/domain.svg + $PNG_ROOT/domain.png"

echo "=== Data flow (Kafka + HTTP/gRPC, curated) ==="
"$SCRIPT_DIR/build-data-flow-dot.sh" "$SCRIPT_DIR/data/data-flow-model.json" "$OUT/flow/data-flow.dot"
"$SCRIPT_DIR/render.sh" "$OUT/flow/data-flow.dot" "$OUT/flow/data-flow.svg" "$PNG_ROOT/data-flow.png"
echo "  → $OUT/flow/data-flow.svg + $PNG_ROOT/data-flow.png"

echo "=== Poster (stack view) ==="
"$SCRIPT_DIR/build-poster-dot.sh" "$OUT/poster/system-architecture.dot"
DOT_DPI="${POSTER_DPI:-300}" "$SCRIPT_DIR/render.sh" "$OUT/poster/system-architecture.dot" "$OUT/poster/system-architecture.svg" "$PNG_ROOT/system-architecture-poster.png"
echo "  → $OUT/poster/system-architecture.svg + $PNG_ROOT/system-architecture-poster.png"

echo "=== Physical (per service DB, heat overlay from pg_stat_user_tables) ==="
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  port="${line%%:*}"
  rest="${line#*:}"
  dbname="${rest%%:*}"
  label="${rest#*:}"
  label="${label:-$dbname}"
  json_path="$OUT/physical/json/${label}.json"
  stats_path="$OUT/physical/json/${label}.stats.json"
  dot_path="$OUT/physical/${label}.dot"
  svg_path="$OUT/physical/${label}.svg"
  if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -X -t -A -c "SELECT 1" &>/dev/null; then
    echo "  skip $label ($port/$dbname) — not reachable"
    continue
  fi
  echo "  $label ($port/$dbname)"
  "$SCRIPT_DIR/export-schema.sh" "$port" "$dbname" "$json_path"
  stats_arg=""
  if [[ "${PHYSICAL_HEAT:-1}" != "0" ]]; then
    if "$SCRIPT_DIR/export-table-stats.sh" "$port" "$dbname" "$stats_path" 2>/dev/null; then
      stats_arg="$stats_path"
    fi
  fi
  "$SCRIPT_DIR/generate-physical-dot.sh" "$json_path" "$dot_path" "Physical: ${label} (${dbname})" "${stats_arg:-}"
  "$SCRIPT_DIR/render.sh" "$dot_path" "$svg_path" "$PNG_ROOT/physical-${label}.png"
  echo "    → $svg_path + $PNG_ROOT/physical-${label}.png"
done <<<"$DB_LIST"

echo "Done. Root: $OUT — all PNGs under $PNG_ROOT"
