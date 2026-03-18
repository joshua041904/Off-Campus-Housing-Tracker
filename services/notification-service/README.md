# notification-service

Consumes Kafka only. Email/push, rent reminders, price drop alerts. Stateless preferred.

**Architecture (v1):** Domain-isolated; cross-domain only via Kafka. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`. See docs/ARCHITECTURE.md.

## Implementing this service (gRPC)

**Contract (source of truth):** [proto/notification.proto](../../proto/notification.proto) defines the RPCs and messages. This service is mostly a Kafka consumer; the proto exposes only preferences and optional read APIs.

**If you're new to gRPC:** See [auth-service README](../auth-service/README.md#implementing-this-service-grpc) for the same 4 steps (proto = contract, generate code, implement handlers, register server).

**This service:** Implements `notification.NotificationService` from [proto/notification.proto](../../proto/notification.proto) (`GetUserPreferences`). Implement [proto/health.proto](../../proto/health.proto) for probes.
