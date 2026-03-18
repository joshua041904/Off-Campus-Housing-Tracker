#!/usr/bin/env bash
# Listings pgbench sweep: benchmark listings DB (port 5442) with trigram and KNN-style search.
# Similar to run_auth_pgbench_sweep.sh but targets listings service DB.
#
# Target: Postgres at localhost:5442, database "listings". Docker: postgres-listings (5442:5432).
# Requires: 01-listings-schema-and-tuning.sql and 02-listings-pgbench-trigram-knn.sql applied.
#   PGPASSWORD=postgres ./scripts/ensure-listings-schema.sh
#   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5442 -U postgres -d listings -f infra/db/02-listings-pgbench-trigram-knn.sql
#
# Variants: listing_create, listing_get, listing_list, listing_search_trgm, noop
# Trigram: pg_trgm on search_norm; listing_search_trgm uses search_listings_fuzzy_count().
set -Euo pipefail

export PGGSSENCMODE=disable

usage() {
  cat <<USAGE
Usage: ${0##*/} [options]
  -u, --user UUID          user_id for listings (default: 0dc268d0-a86f-4e12-8d10-9db0f1b735e0)
  -l, --listing UUID       listing id for get variant (default: from seed or first row)
  -q, --query TEXT         search query for listing_search_trgm (default: "apartment downtown")
  -d, --duration SEC       duration per run (default: 60)
  -c, --clients LIST       client counts (default: 8,16,24,32,48,64)
  -t, --threads N          worker threads (default: 12)
  -h, --help               show this help

Environment:
  MODE=quick|deep          quick (default): 8..64 clients; deep: 8..256
  LISTINGS_DB_HOST         (default: localhost)
  LISTINGS_DB_PORT         (default: 5442)
  TRGM_THRESHOLD           pg_trgm.similarity_threshold (default: 0.4)
USAGE
}

LISTINGS_DB_HOST="${LISTINGS_DB_HOST:-localhost}"
LISTINGS_DB_PORT="${LISTINGS_DB_PORT:-5442}"
LISTINGS_DB_USER="${LISTINGS_DB_USER:-postgres}"
LISTINGS_DB_NAME="${LISTINGS_DB_NAME:-listings}"
LISTINGS_DB_PASS="${LISTINGS_DB_PASS:-postgres}"
export PGPASSWORD="${LISTINGS_DB_PASS}"

USER_UUID="${USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"
LISTING_UUID=""
QUERY="${QUERY:-apartment downtown}"
DURATION=60
MODE="${MODE:-quick}"
if [[ "$MODE" == "deep" ]]; then
  CLIENTS="${CLIENTS:-8,16,24,32,48,64,96,128,192,256}"
else
  CLIENTS="${CLIENTS:-8,16,24,32,48,64}"
fi
THREADS=12
TRGM_THRESHOLD="${TRGM_THRESHOLD:-0.4}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--user) USER_UUID="$2"; shift 2 ;;
    -l|--listing) LISTING_UUID="$2"; shift 2 ;;
    -q|--query) QUERY="$2"; shift 2 ;;
    -d|--duration) DURATION="$2"; shift 2 ;;
    -c|--clients) CLIENTS="$2"; shift 2 ;;
    -t|--threads) THREADS="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$script_dir/.." && pwd)"
LOG_DIR="$REPO_ROOT/bench_logs/listings_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$LOG_DIR"
echo "📁 Logs: $LOG_DIR"

psql_listings() {
  PGPASSWORD="$LISTINGS_DB_PASS" psql -h "$LISTINGS_DB_HOST" -p "$LISTINGS_DB_PORT" \
    -U "$LISTINGS_DB_USER" -d "$LISTINGS_DB_NAME" -X -P pager=off "$@"
}

# Wait for DB
echo "🔍 Checking listings DB at ${LISTINGS_DB_HOST}:${LISTINGS_DB_PORT}..."
if ! psql_listings -c "SELECT 1;" >/dev/null 2>&1; then
  echo "❌ Cannot connect to listings DB. Start postgres-listings (docker compose up -d postgres-listings)." >&2
  exit 1
fi
echo "✅ Database ready"

# Apply 02 if not already applied (search_listings_fuzzy_count exists)
if ! psql_listings -tAc "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'listings' AND p.proname = 'search_listings_fuzzy_count';" 2>/dev/null | grep -q 1; then
  if [[ -f "$REPO_ROOT/infra/db/02-listings-pgbench-trigram-knn.sql" ]]; then
    echo "Applying 02-listings-pgbench-trigram-knn.sql..."
    psql_listings -v ON_ERROR_STOP=1 -f "$REPO_ROOT/infra/db/02-listings-pgbench-trigram-knn.sql" >/dev/null 2>&1 || true
  fi
fi

# Ensure at least one listing for this user (for get/search variants)
SEED_ID=$(psql_listings -tAc "SELECT id FROM listings.listings WHERE user_id = '$USER_UUID' LIMIT 1;" 2>/dev/null || echo "")
if [[ -z "$SEED_ID" ]]; then
  psql_listings -v ON_ERROR_STOP=1 -c "
    INSERT INTO listings.listings (user_id, title, description, listed_at, price_cents, effective_from, status)
    VALUES ('$USER_UUID', 'Bench apartment downtown', 'Nice place for benchmark', CURRENT_DATE, 150000, CURRENT_DATE, 'active')
    RETURNING id;" -tA 2>/dev/null | tr -d ' \r' > "$LOG_DIR/seed_id.txt" || true
  SEED_ID=$(cat "$LOG_DIR/seed_id.txt" 2>/dev/null || echo "")
fi
[[ -z "$LISTING_UUID" ]] && LISTING_UUID="$SEED_ID"
[[ -z "$LISTING_UUID" ]] && LISTING_UUID="$USER_UUID"

PGOPTIONS_EXTRA="-c jit=off -c enable_seqscan=off -c random_page_cost=1.1 -c work_mem=32MB -c pg_trgm.similarity_threshold=$TRGM_THRESHOLD -c search_path=listings,public,bench,pg_catalog"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"; echo "📁 Results in $LOG_DIR"' EXIT

# Bench schema
psql_listings -c "CREATE SCHEMA IF NOT EXISTS bench;" -c "
CREATE TABLE IF NOT EXISTS bench.results (
  id bigserial PRIMARY KEY,
  ts_utc timestamptz DEFAULT now(),
  variant text,
  clients int,
  threads int,
  duration_s int,
  tps numeric,
  lat_avg_ms numeric,
  p50_ms numeric,
  p95_ms numeric,
  run_id text
);" >/dev/null 2>&1

bench_sql_dir="$tmpdir/bench_sql"
mkdir -p "$bench_sql_dir"

# Benchmark SQL files
cat > "$bench_sql_dir/bench_listing_create.sql" <<'EOF'
SET search_path = listings, public, pg_catalog;
INSERT INTO listings.listings (user_id, title, description, listed_at, price_cents, effective_from, status)
VALUES (:uid::uuid, 'Bench ' || random()::text, 'Description ' || random()::text, CURRENT_DATE, 100000 + (random()*50000)::int, CURRENT_DATE, 'active')
RETURNING id;
EOF

cat > "$bench_sql_dir/bench_listing_get.sql" <<'EOF'
SET search_path = listings, public, pg_catalog;
SELECT id, user_id, title, price_cents, created_at FROM listings.listings WHERE id = :lid::uuid;
EOF

cat > "$bench_sql_dir/bench_listing_list.sql" <<'EOF'
SET search_path = listings, public, pg_catalog;
SELECT id, title, price_cents FROM listings.listings WHERE status = 'active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20;
EOF

# Trigram fuzzy search (uses search_listings_fuzzy_count from 02)
cat > "$bench_sql_dir/bench_listing_search_trgm.sql" <<EOFSQL
SET search_path = listings, public, pg_catalog;
SELECT listings.search_listings_fuzzy_count(:uid::uuid, :q::text, 50::bigint);
EOFSQL

cat > "$bench_sql_dir/bench_noop.sql" <<'EOF'
SELECT 1;
EOF

RUN_ID="listings_$(date +%Y%m%d_%H%M%S)"
results_csv="$LOG_DIR/listings_bench_sweep_${RUN_ID}.csv"
echo "ts_utc,variant,clients,threads,duration_s,tps,lat_avg_ms,p50_ms,p95_ms,run_id" > "$results_csv"

run_one() {
  local variant="$1" sql_file="$2" clients="$3"
  local wd="$tmpdir/run_${variant}_${clients}"
  mkdir -p "$wd"
  local duration="$DURATION"
  (( clients >= 128 )) && duration=$(( DURATION * 3 ))

  ( cd "$wd" && \
    PGHOST="$LISTINGS_DB_HOST" PGPORT="$LISTINGS_DB_PORT" PGUSER="$LISTINGS_DB_USER" PGDATABASE="$LISTINGS_DB_NAME" PGPASSWORD="$LISTINGS_DB_PASS" \
    PGOPTIONS="$PGOPTIONS_EXTRA" \
    pgbench -n -M prepared -T "$duration" -c "$clients" -j "$THREADS" \
      -D uid="$USER_UUID" -D lid="$LISTING_UUID" -D q="$QUERY" \
      -l -f "$bench_sql_dir/$sql_file" ) 2>&1 | tee "$wd/out.txt"

  local tps lat_avg p50 p95
  tps=$(sed -n 's/^tps = \([0-9.][0-9.]*\) .*/\1/p' "$wd/out.txt" | tail -n1)
  lat_avg=$(sed -n 's/^latency average = \([0-9.][0-9.]*\) ms$/\1/p' "$wd/out.txt" | tail -n1)
  p50=""; p95=""
  local lat_file
  lat_file=$(ls "$wd"/pgbench_log.* 2>/dev/null | head -1)
  if [[ -n "$lat_file" ]] && [[ -s "$lat_file" ]]; then
    sort -n "$lat_file" -o "$wd/lat.sorted"
    n=$(wc -l < "$lat_file")
    i50=$(awk -v n="$n" 'BEGIN{print (int(0.5*n)+1)}')
    i95=$(awk -v n="$n" 'BEGIN{print (int(0.95*n)+1)}')
    p50=$(sed -n "${i50}p" "$wd/lat.sorted")
    p95=$(sed -n "${i95}p" "$wd/lat.sorted")
  fi
  echo "$(date -u +%FT%TZ),$variant,$clients,$THREADS,$duration,$tps,$lat_avg,$p50,$p95,$RUN_ID" >> "$results_csv"
  echo "  $variant c=$clients tps=$tps lat_avg=${lat_avg}ms"
}

echo "--- Running sweep (clients: $CLIENTS) ---"
IFS=',' read -r -a client_array <<< "$CLIENTS"
declare -a variants=(listing_create listing_get listing_list listing_search_trgm noop)

for c in "${client_array[@]}"; do
  echo "=== clients = $c ==="
  for v in "${variants[@]}"; do
    case "$v" in
      listing_create) f="bench_listing_create.sql" ;;
      listing_get)    f="bench_listing_get.sql" ;;
      listing_list)   f="bench_listing_list.sql" ;;
      listing_search_trgm) f="bench_listing_search_trgm.sql" ;;
      noop)           f="bench_noop.sql" ;;
      *)              f="bench_${v}.sql" ;;
    esac
    run_one "$v" "$f" "$c"
  done
done

cp "$results_csv" "$REPO_ROOT/listings_bench_sweep.csv" 2>/dev/null || true
echo "✅ Wrote $results_csv"
echo "✅ Copied to $REPO_ROOT/listings_bench_sweep.csv"
