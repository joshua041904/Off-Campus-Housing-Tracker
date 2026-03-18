# Shared helpers for load-*-millions.sh scripts.
# Source after setting: DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_PASS
# Optional: PGSQL_VIA_DOCKER=1 to run psql inside the Postgres container (avoids host psql segfault).
# Optional: PG_CONNECT_TIMEOUT (seconds) — fail fast if DB unreachable (default 15).
# Optional: PG_DOCKER_PS_TIMEOUT (seconds) — max wait for "docker ps" (default 25). Colima/Docker can hang; we never block indefinitely.
# Optional: PG_CONTAINER_CACHE_TTL (seconds) — reuse last container name for this port (default 120). Set 0 to disable cache.
# Provides: ts, psql, _psql_connect

ts() { printf '%s' "$(date '+%Y-%m-%d %H:%M:%S')"; }

_PG_CONNECT_TIMEOUT="${PG_CONNECT_TIMEOUT:-15}"
_PG_DOCKER_PS_TIMEOUT="${PG_DOCKER_PS_TIMEOUT:-25}"
_PG_CONTAINER_CACHE_TTL="${PG_CONTAINER_CACHE_TTL:-120}"

# Run a command with a timeout (portable: no dependency on GNU timeout). Returns 124 on timeout.
_run_with_timeout() {
  local timeout_sec=$1 out_f=$2
  shift 2
  rm -f "$out_f" "${out_f}.exit"
  ( "$@" > "$out_f" 2>/dev/null; echo $? > "${out_f}.exit" ) & local pid=$!
  local i=0
  while [[ $i -lt "$timeout_sec" ]]; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
    i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    rm -f "$out_f" "${out_f}.exit"
    return 124
  fi
  wait "$pid" 2>/dev/null
  local ec; ec=$(cat "${out_f}.exit" 2>/dev/null); rm -f "${out_f}.exit"
  return "${ec:-1}"
}

if [[ "${PGSQL_VIA_DOCKER:-0}" == "1" ]]; then
  _PG_CONTAINER=""
  _cache_file="/tmp/record-platform-pg-container-${DB_PORT}"

  if [[ "$_PG_CONTAINER_CACHE_TTL" -gt 0 ]] && [[ -f "$_cache_file" ]]; then
    _now=$(date +%s)
    _mtime=$(stat -f %m "$_cache_file" 2>/dev/null || stat -c %Y "$_cache_file" 2>/dev/null)
    if [[ -n "$_mtime" ]] && [[ $((_now - _mtime)) -lt "$_PG_CONTAINER_CACHE_TTL" ]]; then
      _PG_CONTAINER=$(head -1 "$_cache_file" 2>/dev/null)
      if [[ -n "$_PG_CONTAINER" ]]; then
        echo "$(ts) Using cached container (port ${DB_PORT}): $_PG_CONTAINER"
      fi
    fi
  fi

  if [[ -z "$_PG_CONTAINER" ]]; then
    echo "$(ts) Finding Postgres container (port ${DB_PORT}, timeout ${_PG_DOCKER_PS_TIMEOUT}s)..."
    _out="/tmp/pgcontainer.$$.${DB_PORT}"
    if _run_with_timeout "$_PG_DOCKER_PS_TIMEOUT" "$_out" docker ps -q --filter "publish=${DB_PORT}" --format '{{.Names}}'; then
      _PG_CONTAINER=$(head -1 "$_out" 2>/dev/null)
      [[ "$_PG_CONTAINER_CACHE_TTL" -gt 0 ]] && [[ -n "$_PG_CONTAINER" ]] && printf '%s\n' "$_PG_CONTAINER" > "$_cache_file"
    fi
    rm -f "$_out"
    if [[ -z "$_PG_CONTAINER" ]]; then
      echo "$(ts) Cannot find Postgres container for port ${DB_PORT}. Start Docker Compose (docker compose up -d). If Docker is slow (Colima), we timed out after ${_PG_DOCKER_PS_TIMEOUT}s; try warming up: docker ps" >&2
      exit 1
    fi
    echo "$(ts) Container: $_PG_CONTAINER"
  fi
  psql() {
    docker exec -i "$_PG_CONTAINER" env PGPASSWORD="$DB_PASS" PGCONNECT_TIMEOUT="$_PG_CONNECT_TIMEOUT" psql -h 127.0.0.1 -p 5432 -U "$DB_USER" -X -P pager=off "$@"
  }
  _psql_connect() {
    docker exec -i "$_PG_CONTAINER" env PGPASSWORD="$DB_PASS" PGCONNECT_TIMEOUT="$_PG_CONNECT_TIMEOUT" psql -h 127.0.0.1 -p 5432 -U "$DB_USER" -d "${1:-postgres}" -X -P pager=off -c "${2:-SELECT 1;}" 2>/dev/null
  }
else
  psql() {
    command env PGPASSWORD="$DB_PASS" PGCONNECT_TIMEOUT="$_PG_CONNECT_TIMEOUT" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -X -P pager=off "$@"
  }
  _psql_connect() {
    command env PGPASSWORD="$DB_PASS" PGCONNECT_TIMEOUT="$_PG_CONNECT_TIMEOUT" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "${1:-postgres}" -X -P pager=off -c "${2:-SELECT 1;}" 2>/dev/null
  }
fi
