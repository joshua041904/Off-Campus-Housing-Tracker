# api-gateway

Single public entrypoint: JWT validation, rate limiting, and gRPC proxy to the seven housing backend services. No business logic; routes and forwards requests.

**Architecture:** All client traffic hits the gateway (port 4020). The gateway validates JWT (via auth-service when needed), applies policy, then forwards gRPC to the appropriate backend. See root [README.md](../../README.md) and [docs/HOUSING_ARCHITECTURE_CONTRACT.md](../../docs/HOUSING_ARCHITECTURE_CONTRACT.md).

## Supported backends (gRPC)

The gateway routes to these services. Each contract is defined in the repo root **proto/** directory:

| Service           | Proto (contract)           | Notes                          |
|-------------------|----------------------------|--------------------------------|
| auth-service      | [proto/auth.proto](../../proto/auth.proto)       | Register, Login, ValidateToken |
| listings-service  | [proto/listings.proto](../../proto/listings.proto)   | CreateListing, GetListing, SearchListings |
| booking-service   | [proto/booking.proto](../../proto/booking.proto)   | CreateBooking, Confirm, Cancel, GetBooking |
| messaging-service | [proto/messaging.proto](../../proto/messaging.proto) | SendMessage, GetConversation   |
| notification-service | [proto/notification.proto](../../proto/notification.proto) | GetUserPreferences (consumer mostly via Kafka) |
| trust-service     | [proto/trust.proto](../../proto/trust.proto)     | FlagListing, SubmitReview, GetReputation |
| analytics-service | [proto/analytics.proto](../../proto/analytics.proto) | GetDailyMetrics, GetRecommendations; admin RPCs internal-only |

Shared types: [proto/common.proto](../../proto/common.proto). Health: [proto/health.proto](../../proto/health.proto).

**Implementing a backend:** See each service’s README (e.g. [auth-service/README.md](../auth-service/README.md#implementing-this-service-grpc)) for gRPC implementation steps and proto references.

## Build and run

Uses `services/common` for shared utilities. Port is set by `GATEWAY_PORT` (default 4020). In K8s, config comes from `app-config` ConfigMap; proto files are mounted from the `proto-files` ConfigMap (sourced from repo **proto/**).
