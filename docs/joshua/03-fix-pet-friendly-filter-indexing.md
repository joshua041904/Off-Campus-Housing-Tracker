# Issue 3 — Fix pet-friendly filter indexing

**Owner:** Joshua · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md)

## Why

DB + query correctness: a listing created with `pet_friendly: true` must appear in **`pet_friendly=1`** search results. Missing or wrong **index** can cause slow scans; wrong **SQL** can exclude valid rows.

## Scope

`listings-service` (Postgres schema + search query)

## Files to touch

| File | Role |
|------|------|
| [`services/listings-service/src/search-listings-query.ts`](../../services/listings-service/src/search-listings-query.ts) | When `pets` true: `where.push('pet_friendly = true')` (~L55) |
| [`services/listings-service/src/http-server.ts`](../../services/listings-service/src/http-server.ts) | Maps `pet_friendly` query param → `pets` (~L192) |
| [`services/listings-service/src/grpc-server.ts`](../../services/listings-service/src/grpc-server.ts) | gRPC search must keep same filter semantics |
| **Schema / migrations** | e.g. `infra/db` or service-specific SQL — add **partial or composite index** on `(pet_friendly) WHERE ...` if profiling shows seq scan |
| [`services/listings-service/tests/search-listings-query.test.ts`](../../services/listings-service/tests/search-listings-query.test.ts) | Assert SQL contains `pet_friendly = true` |

Locate listings table DDL in repo (path may vary):

```bash
rg -n "pet_friendly" infra services/listings-service --glob "*.sql"
```

## Step 1 — Create pet-friendly listing

Use UI or authenticated `POST /api/listings/create` with `"pet_friendly": true`.

## Step 2 — Search with filter

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?pet_friendly=1&sort=created_desc"
```

**Success:** Response `items` includes the new listing **id**.

## Step 3 — DB verification (optional)

```bash
# Example: port-forward listings DB and query — adjust port/DB per your env
# psql -c "SELECT id, pet_friendly FROM listings.listings WHERE id = '<uuid>';"
```

**Success:** Row shows `pet_friendly = true`.

## Step 4 — Index (if issue is performance)

Run `EXPLAIN (ANALYZE, BUFFERS)` on the search SQL with `pet_friendly=1`. If sequential scan on large table, add index:

- Example direction: `CREATE INDEX CONCURRENTLY ... ON listings.listings (pet_friendly) WHERE status = 'active' AND deleted_at IS NULL;`  
  (Exact definition must match your `WHERE` in `buildListingsSearchQuery`.)

## Success criteria

| Check | Expected |
|--------|-----------|
| Filter | `pet_friendly=1` returns only rows with `pet_friendly` true |
| New listing | Appears after create + search |
| gRPC | Same behavior as HTTP |

## Debug matrix

| Symptom | Likely cause |
|--------|----------------|
| Row missing | `status` not `active`, `deleted_at` set, or boolean stored false |
| Slow query | Missing index on filtered columns |

## Verification checklist

- [ ] Created **pet-friendly** listing appears in **`pet_friendly=1`** search.
- [ ] **HTTP + gRPC** aligned.
- [ ] **Test** updated or added for SQL filter.
- [ ] **Index** added if profiling warrants it.

## Done when

Created listing appears in filtered results — per backlog.

## Rebuild hint

`pnpm run rebuild:service:listings`. Apply DB migration through your normal migration path.
