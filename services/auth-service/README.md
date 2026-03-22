# auth-service

Owns: user accounts, roles (tenant, landlord, admin), JWT issuance and validation, account state (active, suspended), MFA/passkeys. DB: auth. No other service touches this database.

**Architecture (v1):** Domain-isolated; no cross-service DB access. Gateway and services may call auth for token validation only. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`, Prisma schema. Restore from `backups/5437-auth.dump` when using ported DB (see backups/README.txt).

**Prisma `generate` on Apple Silicon (intermittent crash):** If `pnpm build` dies with `assertion failed [block != nullptr]: BasicBlock requested for unrecognized address` / **Abort trap: 6**, the build already runs `scripts/prisma-generate-retry.sh` (default **5** attempts, backoff). Override retries: `PRISMA_GENERATE_RETRIES=8 pnpm build`. From repo root: `pnpm -C services/auth-service build`. CI/Linux is unaffected. See [prisma#20739](https://github.com/prisma/prisma/discussions/20739).

## Implementing this service (gRPC)

**Contract (source of truth):** [proto/auth.proto](../../proto/auth.proto) defines the RPCs and messages. Use it as the single source of truth.

**If you're new to gRPC:**
1. **Proto** = API contract. The `.proto` file defines the service (e.g. `AuthService`: `Register`, `Login`, `ValidateToken`) and request/response messages.
2. **Generate code** from the proto (e.g. `buf generate` or `protoc`) to get server stubs and client types in TypeScript/Node.
3. **Implement** the generated service interface: each RPC becomes a handler (e.g. `Login` → validate credentials, issue JWT). Your code uses the DB; the gRPC server wires requests to your handlers.
4. **Register** the service on your gRPC server and listen on the configured port (see `PROTO_ROOT`, app-config; in K8s the service is exposed on port 50061 for gRPC).

**This service:** Implements `auth.AuthService` from [proto/auth.proto](../../proto/auth.proto). Also implement [proto/health.proto](../../proto/health.proto) for readiness/liveness probes.
