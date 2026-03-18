# Helpers for DB verification after writes. Source from test scripts.
# Uses psql against localhost (auth 5437, records 5433, social 5434, listings 5435).

db_verify_user() {
  local uid="$1"
  [[ -z "$uid" ]] && return 0
  local c
  c=$(PGPASSWORD=postgres psql -h localhost -p 5437 -U postgres -d records -tAc "SELECT COUNT(*) FROM auth.users WHERE id='$uid';" 2>/dev/null || echo "0")
  if [[ "$c" == "1" ]]; then
    echo "✅ DB verify: user $uid exists in auth.users (port 5437)"
  else
    echo "⚠️  DB verify: user $uid NOT in auth.users (port 5437) count=$c"
  fi
}

db_verify_record() {
  local rid="$1"
  [[ -z "$rid" ]] && return 0
  local c
  c=$(PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -tAc "SELECT COUNT(*) FROM records.records WHERE id='$rid';" 2>/dev/null || echo "0")
  if [[ "$c" == "1" ]]; then
    echo "✅ DB verify: record $rid exists in records.records (port 5433)"
  else
    echo "⚠️  DB verify: record $rid NOT in records.records (port 5433) count=$c"
  fi
}

db_verify_forum_post() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  local c
  c=$(PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d records -tAc "SELECT COUNT(*) FROM forum.posts WHERE id='$pid';" 2>/dev/null || echo "0")
  if [[ "$c" == "1" ]]; then
    echo "✅ DB verify: forum post $pid exists in forum.posts (port 5434)"
  else
    echo "⚠️  DB verify: forum post $pid NOT in forum.posts (port 5434) count=$c"
  fi
}

db_verify_listing() {
  local lid="$1"
  [[ -z "$lid" ]] && return 0
  local c
  c=$(PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d records -tAc "SELECT COUNT(*) FROM listings.listings WHERE id='$lid';" 2>/dev/null || echo "0")
  if [[ "$c" == "1" ]]; then
    echo "✅ DB verify: listing $lid exists in listings.listings (port 5435)"
  else
    echo "⚠️  DB verify: listing $lid NOT in listings.listings (port 5435) count=$c"
  fi
}
