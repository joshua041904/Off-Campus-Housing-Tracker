#!/usr/bin/env bash
# Backup all external Postgres DBs (portable: N DBs, PGPASSWORD in script, report with timestamp).
# Usage: ./scripts/backup-all-dbs.sh [backup-dir]
#   backup-dir defaults to backups/; report written to backup-dir/backup-report-<timestamp>.md
# Env: PGHOST (default localhost), PGPASSWORD (default postgres). DB list from BACKUP_DBS or built-in 8-DB layout.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Default password so it doesn't need to be typed repeatedly; override with env if needed.
export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-postgres}"

BACKUP_BASE="${1:-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_BASE/backup-$TIMESTAMP"
REPORT_FILE="$BACKUP_DIR/backup-report-$TIMESTAMP.md"
mkdir -p "$BACKUP_DIR"

# Default: 8 DBs (off-campus-housing-tracker layout). Format: port:dbname:label (one per line).
# Override with BACKUP_DBS (e.g. "5433:records:records 5434:records:social ..." or a file path).
if [[ -z "${BACKUP_DBS:-}" ]]; then
  BACKUP_DBS="5433:records:records
5434:records:social
5435:records:listings
5436:records:shopping
5437:auth:auth
5438:records:auction_monitor
5439:records:analytics
5440:python_ai:python_ai"
fi

# If BACKUP_DBS is a file path, read it; else use as-is (multi-line or space-separated)
if [[ -n "${BACKUP_DBS:-}" ]] && [[ -f "${BACKUP_DBS:-}" ]]; then
  DB_LIST="$(cat "$BACKUP_DBS")"
elif [[ -n "${BACKUP_DBS:-}" ]]; then
  DB_LIST="$(echo "$BACKUP_DBS" | tr ' ' '\n' | grep -v '^$')"
else
  DB_LIST="$BACKUP_DBS"
fi

echo "=== Backup all DBs ==="
echo "Backup dir: $BACKUP_DIR"
echo "Report:     $REPORT_FILE"
echo ""

{
  echo "# Backup report — $TIMESTAMP"
  echo ""
  echo "Generated: $(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')"
  echo ""
  echo "| Port | Database | Label | File | Size | Status |"
  echo "|------|----------|-------|------|------|--------|"
} > "$REPORT_FILE"

OK=0
FAIL=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  port="${line%%:*}"
  rest="${line#*:}"
  dbname="${rest%%:*}"
  label="${rest#*:}"
  label="${label:-$dbname}"
  outfile="$BACKUP_DIR/${label}-${port}.dump"
  if PGPASSWORD="$PGPASSWORD" pg_dump -h "$PGHOST" -p "$port" -U "$PGUSER" -d "$dbname" -Fc -f "$outfile" 2>/dev/null; then
    size="$(ls -lh "$outfile" 2>/dev/null | awk '{print $5}')"
    echo "| $port | $dbname | $label | $outfile | $size | OK |" >> "$REPORT_FILE"
    echo "  $port $dbname ($label) -> $outfile ($size)"
    ((OK+=1)) || true
  else
    echo "| $port | $dbname | $label | — | — | FAIL |" >> "$REPORT_FILE"
    echo "  $port $dbname ($label) -> FAIL"
    ((FAIL+=1)) || true
  fi
done <<< "$DB_LIST"

{
  echo ""
  echo "---"
  echo "Summary: $OK OK, $FAIL failed."
} >> "$REPORT_FILE"

echo ""
echo "Report: $REPORT_FILE"
[[ $FAIL -gt 0 ]] && exit 1
exit 0
