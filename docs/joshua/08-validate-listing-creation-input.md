# Issue 8 — Validate listing creation input

**Owner:** Joshua · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md)

## Why

Invalid bodies must return **400** with a clear message — never **500** for validation failures.

## Scope

`services/listings-service`

## Files (core)

| File | Role |
|------|------|
| [`services/listings-service/src/validation.ts`](../../services/listings-service/src/validation.ts) | `validateCreateListingInput`, `validateListingId`, types |
| [`services/listings-service/src/http-server.ts`](../../services/listings-service/src/http-server.ts) | `POST /create` uses `validateCreateListingInput`; **400** on `!validation.ok` (~L262) |
| [`services/listings-service/src/grpc-server.ts`](../../services/listings-service/src/grpc-server.ts) | gRPC create — keep rules in sync |
| [`services/listings-service/tests/validation.test.ts`](../../services/listings-service/tests/validation.test.ts) | Unit tests |

## Step 1 — Missing title

```bash
TOKEN="<jwt>"
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"x","price_cents":100,"effective_from":"2030-01-01"}' \
  "${EDGE_BASE_HTTPS}/api/listings/create"
```

**Success:** **400** + JSON `error` message (not 500).

## Step 2 — Missing / invalid price

```bash
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"T","description":"d","effective_from":"2030-01-01"}' \
  "${EDGE_BASE_HTTPS}/api/listings/create"
```

**Success:** **400**.

## Step 3 — Run listings-service tests

```bash
cd "$(git rev-parse --show-toplevel)"
pnpm --filter listings-service test
```

## Success criteria

| Case | HTTP |
|------|------|
| Missing required fields | **400** |
| Invalid date / negative price | **400** |
| DB failure / bug | **500** only for true internal errors |

## Debug matrix

| Symptom | Likely cause |
|--------|----------------|
| 500 on bad input | Validation not reached; thrown before catch |
| Inconsistent gRPC | HTTP path updated, gRPC not |

## Verification checklist

- [ ] Missing **title** → **400**.
- [ ] Missing / invalid **price** → **400**.
- [ ] **No** invalid request returns **500** for pure validation failures.
- [ ] **Tests** cover new edge cases.

## Done when

Per backlog: invalid inputs → **400**; **500** only for unexpected server errors.

## Rebuild hint

`pnpm run rebuild:service:listings`
