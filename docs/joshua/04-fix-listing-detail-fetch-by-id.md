# Issue 4 — Fix listing detail fetch by ID

**Owner:** Joshua · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md)

## Public URL (this repo)

```text
GET ${EDGE_BASE_HTTPS}/api/listings/listings/${LISTING_ID}
Upstream: GET /listings/:id on listings-service (gateway strips /api/listings)
```

## Why

Single-listing view must return **200 + JSON** for valid UUIDs, **400** for invalid ids, **404** when missing — without breaking gateway routing.

## Files (authoritative)

| File | Role |
|------|------|
| [`services/api-gateway/src/server.ts`](../../services/api-gateway/src/server.ts) | `OPEN_ROUTES` includes `GET` for `/api/listings/listings/:id` (~L176) |
| [`services/listings-service/src/http-server.ts`](../../services/listings-service/src/http-server.ts) | `app.get("/listings/:id", ...)` (~L223) |
| [`services/listings-service/src/validation.ts`](../../services/listings-service/src/validation.ts) | `validateListingId` (~L95+) |
| [`webapp/lib/api.ts`](../../webapp/lib/api.ts) | `getListing(id)` → `/api/listings/listings/${encodeURIComponent(id)}` (~L175) |

## Step 0 — Environment

Hub [`Step 0`](../JOSHUA_ISSUES_PLAYBOOK.md#step-0--environment-curl-against-edge).

## Step 1 — Fetch by valid UUID

```bash
export LISTING_ID="<valid-uuid-from-search>"
curl --http2 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/listings/${LISTING_ID}"
```

**Success:** `HTTP/2 200`; JSON includes `id`, `title`, `price_cents`.

## Step 2 — Invalid UUID

```bash
curl --http2 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/listings/not-a-uuid"
```

**Success:** **400** JSON `{ "error": "..." }` — **not** 500.

## Step 3 — HTTP/1.1 cross-check

```bash
curl --http1.1 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/listings/${LISTING_ID}"
```

**Success:** **200** for valid id (same JSON shape as HTTP/2).

## Step 4 — Webapp “Load detail”

On `/listings`, paste id into detail field and submit — uses `getListing` in [`webapp/app/listings/page.tsx`](../../webapp/app/listings/page.tsx) (`onLoadDetail`).

## Failure matrix

| Status | Meaning |
|--------|---------|
| **401** | `OPEN_ROUTES` missing for `/api/listings/listings/*` |
| **404** | Gateway pathRewrite wrong **or** row missing / soft-deleted |
| **400** | `validateListingId` rejected bad UUID |
| **500** | DB error / uncaught exception |

## Verification checklist

- [ ] Valid UUID → **200** + JSON row.
- [ ] Invalid UUID → **400** (not 500).
- [ ] **HTTP/1.1** + **HTTP/2** both **200** for valid id (same `--resolve` pattern).
- [ ] Webapp detail panel shows listing.

## Done when

Matches checklist above — per [`Github_issues copy.txt`](../../Github_issues%20copy.txt).

## Rebuild hint

Listings + gateway if routing changes: `SERVICES="listings-service api-gateway" ./scripts/rebuild-och-images-and-rollout.sh`.
