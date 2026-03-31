# Issue 6 — Store metadata for uploaded media

**Owner:** Joshua · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md)

## Why

Every upload should persist **filename**, **size**, **content type** (and related fields) so clients can list and validate objects.

## Scope

`services/media-service`

## Files to touch

| File | Role |
|------|------|
| [`services/media-service/src/db/mediaRepo.ts`](../../services/media-service/src/db/mediaRepo.ts) | `INSERT INTO media.media_files (... filename, content_type, size_bytes ...)` (~L74) |
| [`services/media-service/src/handlers/createUploadUrl.ts`](../../services/media-service/src/handlers/createUploadUrl.ts) | Validates input filename / type / size |
| [`services/media-service/src/grpc-server.ts`](../../services/media-service/src/grpc-server.ts) | gRPC `createUploadUrl` — `filename`, `content_type`, `size_bytes` from request (~L25) |
| [`services/media-service/tests/integration/media-upload.integration.test.ts`](../../services/media-service/tests/integration/media-upload.integration.test.ts) | Example `filename: 'test.png'` |
| **Schema** | `media.media_files` columns — confirm in `infra/db` or service migrations |

## Step 1 — Unit / integration tests

```bash
cd "$(git rev-parse --show-toplevel)"
pnpm --filter media-service test
```

## Step 2 — gRPC or HTTP (per your public API)

If gateway exposes media routes, test through edge; else port-forward:

```bash
kubectl port-forward svc/media-service 4018:4018 -n off-campus-housing-tracker
# Then call the appropriate health + upload-init endpoint per media-service README
```

## Step 3 — DB row check

After upload URL flow completes, query:

```sql
SELECT id, filename, content_type, size_bytes, status FROM media.media_files ORDER BY created_at DESC LIMIT 5;
```

**Success:** New row has **non-null** `filename`, `content_type`, `size_bytes` as required.

## Success criteria

| Check | Expected |
|--------|-----------|
| Persist | All required metadata stored on create |
| API | GET/list or gRPC returns metadata to clients |
| Validation | Reject missing/oversized per product rules |

## Debug matrix

| Symptom | Likely cause |
|--------|----------------|
| Null filename | Handler not passing through proto/HTTP body |
| Wrong type | Client sends wrong header; normalization missing |

## Verification checklist

- [ ] **filename, size, type** saved on upload init / complete flow.
- [ ] **Retrievable** via API response or DB.
- [ ] **Tests** cover happy path + invalid input.

## Done when

Metadata visible in response or DB — per backlog.

## Rebuild hint

`pnpm run rebuild:service:media`
