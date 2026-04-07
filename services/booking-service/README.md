# booking-service

Owns: reservation state machine, booking lifecycle, cancellation, landlord approval. DB: bookings. Emit: booking_created, booking_confirmed, booking_cancelled.

**Architecture (v1):** Domain-isolated; no cross-service DB access. Cross-domain only via Kafka. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`, Prisma schema. See docs/ARCHITECTURE.md.

## Implementing this service (gRPC)

**Contract (source of truth):** [proto/booking.proto](../../proto/booking.proto) defines the RPCs and messages.

**If you're new to gRPC:** See [auth-service README](../auth-service/README.md#implementing-this-service-grpc) for the same 4 steps (proto = contract, generate code, implement handlers, register server).

**This service:** Implements `booking.BookingService` from [proto/booking.proto](../../proto/booking.proto) (`CreateBooking`, `ConfirmBooking`, `CancelBooking`, `GetBooking`). Emit Kafka events on state changes. Implement [proto/health.proto](../../proto/health.proto) for probes.

## Image rollout

After changing service code, rebuild and roll the workload (Colima/k3s):

`./scripts/rebuild-och-images-and-rollout.sh` (or your usual tag/push flow). ConfigMap **`app-config`** already sets **`KAFKA_BROKER`** to a **comma-separated three-broker** bootstrap for in-cluster TLS (`kafka-0…:9093`, …); pods pick that up on deploy.

## Integration tests (HTTP + Postgres + Kafka cluster)

**Cluster-only:** no plaintext `127.0.0.1:9092`. You need **≥3 TLS broker seeds** (MetalLB `:9094` or explicit bootstrap) and client PEMs under **`certs/kafka-ssl/`** or **`certs/kafka-ssl-ci/`**.

```bash
pnpm run test:integration
```

This sets **`OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1`** (legacy alias: **`BOOKING_IT_KAFKA_FROM_K8S_LB=1`**), discovers **`kafka-0-external` … `kafka-2-external`** LoadBalancer IPs in **`off-campus-housing-tracker`** (override with **`HOUSING_NS`**, **`OCH_INTEGRATION_K8S_NAMESPACE`**, or **`BOOKING_IT_K8S_NAMESPACE`**), uses **`ip0:9094,ip1:9094,ip2:9094`** with mTLS, runs **globalSetup** to **create the booking events topic** if missing (3 partitions, RF 3), then runs tests. Shared logic: **`@common/utils/kafka-vitest-cluster`**.

Requires **`booking.bookings.tenant_notes`** and reachable **`POSTGRES_URL_BOOKINGS`** (default `127.0.0.1:5443/bookings`).

**Without kubectl** (static three seeds, same TLS material):

```bash
export KAFKA_BROKER="192.168.64.242:9094,192.168.64.241:9094,192.168.64.243:9094"
export KAFKA_SSL_ENABLED=true
export KAFKA_SSL_SKIP_HOSTNAME_CHECK=1
export KAFKA_CA_CERT=... KAFKA_CLIENT_CERT=... KAFKA_CLIENT_KEY=...
# Optional: also set BOOKING_IT_KAFKA_BROKERS instead of KAFKA_BROKER
pnpm run test:integration
```

If **`KAFKA_BROKER`** is already set, **`pnpm run test:integration`** still passes **`BOOKING_IT_KAFKA_FROM_K8S_LB=1`**, but discovery is skipped because explicit bootstrap wins.

**GitHub Actions:** this suite is **not** run in CI (no k3s/MetalLB there). Run it locally against your Colima cluster.

## Implemented HTTP surface (v1)

The gateway strips `/api/booking`, so these are booking-service local paths:

- `POST /create` - create booking (`status=CREATED`)
- `POST /confirm` - confirm booking (`status=CONFIRMED`)
- `POST /cancel` - cancel booking (`status=CANCELLED`; soft state change, not delete). Tenant or landlord (`landlordId` on the row) only.
- `PATCH /:bookingId` - update `tenantNotes` (tenant only; string or `null` to clear). Blocked when status is `cancelled` or `completed`.
- `GET /:bookingId` - fetch booking for current tenant
- `POST /search-history` - persist per-user search history
- `GET /search-history/list` - list recent per-user search history
- `POST /watchlist/add` - add/reactivate watchlist item
- `POST /watchlist/remove` - soft-remove watchlist item
- `GET /watchlist/list` - list active watchlist
- `GET /healthz`, `GET /metrics`

Auth identity is taken from `x-user-id` (set by `api-gateway` after JWT validation).

## Maps / location

- **Webapp:** set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Google Maps **Embed API**) for map previews on listings and dashboard; optional `latitude` / `longitude` on `POST /search-history` are stored for “search near here”.
- **Server (optional):** a future geocode step can use `GOOGLE_MAPS_API_KEY` (Geocoding API) — keep keys restricted by API product and referrer / IP in Google Cloud Console.
