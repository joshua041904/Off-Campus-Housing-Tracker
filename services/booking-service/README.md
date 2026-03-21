# booking-service

Owns: reservation state machine, booking lifecycle, cancellation, landlord approval. DB: bookings. Emit: booking_created, booking_confirmed, booking_cancelled.

**Architecture (v1):** Domain-isolated; no cross-service DB access. Cross-domain only via Kafka. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`, Prisma schema. See docs/ARCHITECTURE.md.

## Implementing this service (gRPC)

**Contract (source of truth):** [proto/booking.proto](../../proto/booking.proto) defines the RPCs and messages.

**If you're new to gRPC:** See [auth-service README](../auth-service/README.md#implementing-this-service-grpc) for the same 4 steps (proto = contract, generate code, implement handlers, register server).

**This service:** Implements `booking.BookingService` from [proto/booking.proto](../../proto/booking.proto) (`CreateBooking`, `ConfirmBooking`, `CancelBooking`, `GetBooking`). Emit Kafka events on state changes. Implement [proto/health.proto](../../proto/health.proto) for probes.

## Implemented HTTP surface (v1)

The gateway strips `/api/booking`, so these are booking-service local paths:

- `POST /create` - create booking (`status=CREATED`)
- `POST /confirm` - confirm booking (`status=CONFIRMED`)
- `POST /cancel` - cancel booking (`status=CANCELLED`)
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
