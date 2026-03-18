# auth-service

Owns: user accounts, roles (tenant, landlord, admin), JWT issuance and validation, account state (active, suspended), MFA/passkeys. DB: auth. No other service touches this database.

**Architecture (v1):** Domain-isolated; no cross-service DB access. Gateway and services may call auth for token validation only. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`, Prisma schema. Restore from `backups/5437-auth.dump` when using ported DB (see backups/README.txt).
