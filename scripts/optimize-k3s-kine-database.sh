#!/usr/bin/env bash
# Optimize k3s kine database to prevent API server wedging
# kine can use SQLite (default) or PostgreSQL/MySQL
# This script optimizes SQLite or provides recommendations for other backends

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }
info() { echo "ℹ️  $*"; }

say "=== Optimizing k3s kine Database ==="

# Check if k3s is accessible
if ! kubectl cluster-info >/dev/null 2>&1; then
  fail "k3s API server is not accessible"
  say "Please restart k3s first:"
  say "  colima kubernetes stop && colima kubernetes start"
  exit 1
fi

ok "k3s API server is accessible"

# Detect database backend
say "=== Detecting kine Database Backend ==="
KINE_BACKEND=""
KINE_DB_PATH=""

# Check for SQLite (default)
if colima ssh -- sh -c "test -f /var/lib/rancher/k3s/server/db/state.db" 2>/dev/null; then
  KINE_BACKEND="sqlite"
  KINE_DB_PATH="/var/lib/rancher/k3s/server/db/state.db"
  ok "Detected SQLite backend at $KINE_DB_PATH"
elif colima ssh -- sh -c "test -f /var/lib/rancher/k3s/server/db/kine.db" 2>/dev/null; then
  KINE_BACKEND="sqlite"
  KINE_DB_PATH="/var/lib/rancher/k3s/server/db/kine.db"
  ok "Detected SQLite backend at $KINE_DB_PATH"
else
  # Check for PostgreSQL/MySQL via environment
  KINE_ENDPOINT=$(colima ssh -- sh -c "grep -i 'datastore-endpoint' /etc/systemd/system/k3s.service.env 2>/dev/null | cut -d'=' -f2" 2>/dev/null || echo "")
  if [[ -n "$KINE_ENDPOINT" ]]; then
    if echo "$KINE_ENDPOINT" | grep -q "postgres"; then
      KINE_BACKEND="postgresql"
      ok "Detected PostgreSQL backend: $KINE_ENDPOINT"
    elif echo "$KINE_ENDPOINT" | grep -q "mysql"; then
      KINE_BACKEND="mysql"
      ok "Detected MySQL backend: $KINE_ENDPOINT"
    fi
  else
    warn "Could not detect database backend - assuming SQLite"
    KINE_BACKEND="sqlite"
  fi
fi

# Optimize based on backend
if [[ "$KINE_BACKEND" == "sqlite" ]]; then
  say "=== Optimizing SQLite Database ==="
  
  if [[ -z "$KINE_DB_PATH" ]]; then
    # Try to find it
    KINE_DB_PATH=$(colima ssh -- sh -c "find /var/lib/rancher/k3s -name '*.db' -type f 2>/dev/null | head -1" 2>/dev/null || echo "")
  fi
  
  if [[ -z "$KINE_DB_PATH" ]]; then
    warn "Could not find SQLite database file"
    exit 1
  fi
  
  info "Database path: $KINE_DB_PATH"
  
  # Check database size
  DB_SIZE=$(colima ssh -- sh -c "du -sh $KINE_DB_PATH 2>/dev/null | cut -f1" 2>/dev/null || echo "unknown")
  info "Database size: $DB_SIZE"
  
  # Check if database is locked (k3s must be stopped)
  say "⚠️  WARNING: SQLite optimization requires stopping k3s"
  say "This will cause brief downtime (~30 seconds)"
  read -p "Continue? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    info "Skipping optimization"
    exit 0
  fi
  
  say "Stopping k3s..."
  colima kubernetes stop
  sleep 3
  
  say "Optimizing SQLite database..."
  colima ssh -- sh -c "
    sqlite3 $KINE_DB_PATH <<'EOFSQL'
-- Analyze tables for better query planning
ANALYZE;

-- Vacuum to reclaim space and optimize
VACUUM;

-- Reindex for better performance
REINDEX;

-- Show table sizes
SELECT 
  name as table_name,
  COUNT(*) as row_count
FROM kine
GROUP BY name
ORDER BY row_count DESC
LIMIT 10;
EOFSQL
  " 2>/dev/null || warn "Optimization completed with warnings"
  
  say "Starting k3s..."
  colima kubernetes start
  sleep 10
  
  # Verify API server is accessible
  if kubectl cluster-info >/dev/null 2>&1; then
    ok "k3s restarted successfully after optimization"
  else
    warn "k3s may need more time to start"
  fi
  
elif [[ "$KINE_BACKEND" == "postgresql" ]]; then
  say "=== PostgreSQL Optimization Recommendations ==="
  info "For PostgreSQL backend, optimize the database directly:"
  echo ""
  echo "1. Run VACUUM ANALYZE on the kine database"
  echo "2. Check for slow queries: SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;"
  echo "3. Consider adding indexes on frequently queried columns"
  echo "4. Monitor connection pool settings"
  echo ""
  warn "PostgreSQL optimization requires direct database access"
  
elif [[ "$KINE_BACKEND" == "mysql" ]]; then
  say "=== MySQL Optimization Recommendations ==="
  info "For MySQL backend, optimize the database directly:"
  echo ""
  echo "1. Run OPTIMIZE TABLE on kine tables"
  echo "2. Check for slow queries: SELECT * FROM mysql.slow_log ORDER BY start_time DESC LIMIT 10;"
  echo "3. Consider adding indexes on frequently queried columns"
  echo "4. Monitor connection pool settings"
  echo ""
  warn "MySQL optimization requires direct database access"
fi

say "=== Additional Optimization Strategies ==="
info "1. Regular k3s restarts (weekly) to prevent accumulation"
info "2. Clean up completed jobs: kubectl delete jobs --field-selector status.successful=1 -A"
info "3. Remove old ReplicaSets: kubectl delete rs --field-selector status.replicas=0 -A"
info "4. Monitor k3s logs for 'Slow SQL' warnings"
info "5. Consider using PostgreSQL backend for better performance at scale"

say "=== Monitoring k3s Performance ==="
info "To monitor k3s database performance:"
echo "  colima ssh -- journalctl -u k3s -f | grep -i 'slow sql'"
echo ""
info "If you see frequent 'Slow SQL' warnings, consider:"
echo "  1. Restarting k3s more frequently"
echo "  2. Switching to PostgreSQL backend"
echo "  3. Reducing cluster resource count (cleanup old resources)"
