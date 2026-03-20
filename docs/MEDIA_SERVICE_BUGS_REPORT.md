# Media Service Bugs – Report

**Date:** 2026-03-19  
**Scope:** Build/runtime issues in `services/media-service` and related fixes.

---

## 1. Rebuild & Redeploy Summary

- **api-gateway**
  - Rebuilt (pnpm build for `@common/utils` and `api-gateway`).
  - Docker image built: `ghcr.io/yourorg/api-gateway:dev`.
  - Redeployed via `kubectl apply -k infra/k8s/overlays/dev`.
  - **Fixes applied for api-gateway to run:**
    - **Kafka:** Set `KAFKA_SSL_ENABLED=false` in api-gateway deploy (gateway does not use Kafka; avoids `@common/utils` kafka module throwing at startup when SSL is enabled but cert paths are missing).
    - **gRPC TLS:** Added `GRPC_INSECURE=true` in api-gateway deploy and support in `services/common/src/grpc-clients.ts` so the gateway can call auth (and other) gRPC services in dev without mounted TLS certs.
  - **Result:** api-gateway is running (1/1 Ready), logs show `[grpc-client] Using insecure credentials` and `gateway redis connected`.

- **media-service**
  - Build succeeds after the fixes below. No separate redeploy was performed in this session; deploy is applied as part of the same `kubectl apply -k infra/k8s/overlays/dev`.

---

## 2. Media-Service Bugs and Fixes

### 2.1 `@common/utils/grpc-health` module not found

- **Symptom:** media-service build/runtime failed with “Cannot find module `@common/utils/grpc-health`”.
- **Cause:** `services/common` did not expose the `grpc-health` subpath in `package.json` `exports` (and `typesVersions`), so the workspace resolver could not resolve `@common/utils/grpc-health`.
- **Fix:** In `services/common/package.json`, added:
  - `"./grpc-health": "./dist/grpc-health.js"` (and corresponding types) to `exports`.
  - Matching entry in `typesVersions` so TypeScript resolves the type definitions.
- **Location:** `services/media-service/src/grpc-server.ts` uses `import { registerHealthService } from '@common/utils/grpc-health'`.

### 2.2 S3 Presigner type error (`S3Client` vs `Client`)

- **Symptom:** TypeScript (or build) error when calling `getSignedUrl(s3Client, command, { expiresIn: ... })`: `S3Client` from `@aws-sdk/client-s3` was not assignable to `Client` expected by `@aws-sdk/s3-request-presigner` (due to `@smithy/types` version mismatch between the two packages).
- **Cause:** Different versions of `@smithy/types` (e.g. 4.9.0 vs 4.13.1) used by `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` led to incompatible type definitions for the client type.
- **Fix (workaround):**
  - In repo root `package.json`, added `pnpm.overrides` to pin `"@smithy/types": "^4.13.1"` and align Smithy types where possible.
  - In `services/media-service/src/storage/s3.ts`, cast the client to `any` for the presigner calls only:
    - `getSignedUrl(s3Client as any, command, { expiresIn: PRESIGN_PUT_EXPIRES })`
    - `getSignedUrl(s3Client as any, command, { expiresIn: PRESIGN_GET_EXPIRES })`
- **Permanent fix (recommended):** When upstream AWS SDK / Smithy types are aligned, remove the `as any` cast and rely on a single `@smithy/types` version across client-s3 and s3-request-presigner. Optionally bump both to a consistent set of `@aws-sdk/*` versions that declare compatible types.

---

## 3. Auth-service build (out of scope for media-service)

- **Note:** `pnpm build` for auth-service was failing on this machine with a Prisma error (“assertion failed … block_for_offset”, Abort trap) during `prisma generate`. This was treated as environment- or Prisma-version specific and was not fixed in this session. Reproduce and fix separately (e.g. Prisma upgrade or environment check).

---

## 4. Files touched (media-service–related)

| Area              | File(s) |
|-------------------|--------|
| grpc-health export| `services/common/package.json` (exports + typesVersions) |
| S3 presigner      | `services/media-service/src/storage/s3.ts` (`as any` on `getSignedUrl`) |
| Smithy types      | Root `package.json` (pnpm.overrides for `@smithy/types`) |

---

## 5. Current status

- **api-gateway:** Rebuilt, redeployed, running with Kafka SSL disabled and gRPC insecure in dev.
- **media-service:** Builds successfully; runtime behavior not re-verified in this session beyond build and deploy apply.
