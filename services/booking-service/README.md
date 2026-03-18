# booking-service

Owns: reservation state machine, booking lifecycle, cancellation, landlord approval. DB: bookings. Emit: booking_created, booking_confirmed, booking_cancelled.

**Architecture (v1):** Domain-isolated; no cross-service DB access. Cross-domain only via Kafka. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`, Prisma schema. See docs/ARCHITECTURE.md.

## Implementing this service (gRPC)

**Contract (source of truth):** [proto/booking.proto](../../proto/booking.proto) defines the RPCs and messages.

**If you're new to gRPC:** See [auth-service README](../auth-service/README.md#implementing-this-service-grpc) for the same 4 steps (proto = contract, generate code, implement handlers, register server).

**This service:** Implements `booking.BookingService` from [proto/booking.proto](../../proto/booking.proto) (`CreateBooking`, `ConfirmBooking`, `CancelBooking`, `GetBooking`). Emit Kafka events on state changes. Implement [proto/health.proto](../../proto/health.proto) for probes.
