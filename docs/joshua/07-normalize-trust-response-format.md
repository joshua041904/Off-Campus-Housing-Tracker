# Issue 7 — Normalize trust-service response format

**Owner:** Joshua · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md)

## Why

Clients (webapp, gateway) should see a **single contract**, e.g. `{ data, error }` or consistent `{ error, code }` on **all** trust HTTP endpoints.

## Scope

`services/trust-service`

## Files to touch

| File | Role |
|------|------|
| [`services/trust-service/src/http-server.ts`](../../services/trust-service/src/http-server.ts) | Express routes: `/report-abuse`, reputation, peer-review, etc. |
| [`services/trust-service/src/grpc-server.ts`](../../services/trust-service/src/grpc-server.ts) | gRPC status + payloads — align semantics with HTTP |
| [`webapp/lib/api.ts`](../../webapp/lib/api.ts) | `reportAbuse` and other `trust` helpers — update parsing when shape changes |
| [`webapp/app/trust/page.tsx`](../../webapp/app/trust/page.tsx) | UI reads response fields |

## Step 1 — Inventory responses

```bash
rg -n "res\.(json|status)" services/trust-service/src/http-server.ts
```

Document each endpoint: success shape vs error shape today.

## Step 2 — curl matrix (through gateway)

Set `TOKEN` and user id headers as required by routes.

```bash
# Example: reputation (often GET, may be open — see gateway OPEN_ROUTES)
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/trust/reputation/<user-uuid>"
```

```bash
# report-abuse: POST JSON — needs auth / x-user-id per implementation
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"target_type":"listing","target_id":"<uuid>","reason":"spam","description":"test"}' \
  "${EDGE_BASE_HTTPS}/api/trust/report-abuse"
```

**Success after change:** Every endpoint returns the **same envelope** (per team spec).

## Step 3 — Webapp alignment

Update `reportAbuse` in [`webapp/lib/api.ts`](../../webapp/lib/api.ts) (~L208) to read `data` / `error` fields.

## Success criteria

| Check | Expected |
|--------|-----------|
| Success | Normalized `data` (or agreed shape) |
| Error | Normalized `error` + optional `code` |
| Status codes | Stable mapping (400 vs 409 vs 500) |

## Debug matrix

| Symptom | Action |
|--------|--------|
| Mixed shapes | Introduce small helper `sendOk(res, data)` / `sendErr(res, status, code, message)` |
| gRPC drift | Map gRPC codes to same logical errors as HTTP |

## Verification checklist

- [ ] **All endpoints** documented with example JSON.
- [ ] **curl** proves consistency across routes.
- [ ] **Webapp** updated if fields changed.
- [ ] **Tests** in trust-service updated.

## Done when

Verified via curl across endpoints — per backlog.

## Rebuild hint

`pnpm run rebuild:service:trust` · webapp if UI parses responses.
