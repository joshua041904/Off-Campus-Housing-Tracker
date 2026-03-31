# Issue 2 — Fix listing creation confirmation UI

**Owner:** Joshua · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md)

## Why

Backend + frontend contract: after a successful **POST /create**, the user should see a **clear confirmation** (banner), not silent success or misleading state.

## Scope

- `webapp` — message / banner after `createListing`
- `listings-service` — response body shape for create (if UI depends on returned id)

## Files to touch

| File | Role |
|------|------|
| [`webapp/app/listings/page.tsx`](../../webapp/app/listings/page.tsx) | `onCreate`: `setMsg("Listing created.")` (~L182); consider persistent **banner** / `role="status"` / link to new listing |
| [`webapp/lib/api.ts`](../../webapp/lib/api.ts) | `createListing()` — `POST /api/listings/create` (via gateway); ensure errors surface |
| [`services/listings-service/src/http-server.ts`](../../services/listings-service/src/http-server.ts) | `POST /create` — response JSON (listing id, etc.) |
| [`services/api-gateway/src/server.ts`](../../services/api-gateway/src/server.ts) | Proxies authenticated create; injects `x-user-id` |

## Step 1 — Manual UI flow

1. Log in (token in storage).
2. On `/listings`, fill **Create listing** form with valid title, price, effective-from.
3. Submit.

**Success:** Visible **banner** or status region confirming create; optional: new row in list after `onSearch()` (~L188).

## Step 2 — curl (auth required)

Obtain JWT (login via edge). Then:

```bash
TOKEN="<paste_jwt>"
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"E2E Confirm Test","description":"d","price_cents":100000,"effective_from":"2030-01-01","smoke_free":true,"pet_friendly":false,"furnished":false,"amenities":[]}' \
  "${EDGE_BASE_HTTPS}/api/listings/create"
```

**Success:** **200** or **201** with JSON including listing **id** (check actual handler).

## Step 3 — Contract check

Compare webapp expectation in `createListing` parsing vs server response fields.

## Success criteria

| Check | Expected |
|--------|-----------|
| Banner / alert | Visible after success |
| Accessibility | `role="status"` or live region if using dynamic message |
| Failure | Error path does not show success banner |

## Debug matrix

| Symptom | Action |
|--------|--------|
| No message | `setMsg` not run; exception before; token null |
| 401 | Not logged in; gateway auth |
| 400 | `validateCreateListingInput` — see Issue 8 doc |

## Verification checklist

- [ ] **Banner** (or equivalent) appears after successful create.
- [ ] **List refreshes** or user can navigate to new listing if product requires.
- [ ] **No false positive** on error.

## Done when

Banner appears after create — per backlog.

## Rebuild hint

Mostly **webapp**; if changing HTTP response: **listings-service** + gateway if path changes.
