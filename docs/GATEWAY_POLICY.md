# API Gateway — Policy-Driven Auth Model

Policy-enforced API gateway with role-based and ownership-based authorization, correlation tracing, and a clear middleware stack.

---

## 1. Middleware stack (order)

1. **TLS termination** — Terminate TLS at gateway; backend calls use mTLS or internal TLS.
2. **JWT verification** — Validate signature and expiry; extract `sub` (user_id), optional `role`.
3. **Policy engine** — Allow/deny by RPC + role + optional ownership check (see matrix).
4. **Rate limiter** — Per-client or per-user limits; 429 on exceed.
5. **Correlation ID injection** — Generate or propagate `x-correlation-id`; pass to backend and logs.
6. **Trace propagation** — Propagate `traceparent` / W3C Trace Context (OpenTelemetry) to gRPC metadata.
7. **gRPC forwarder** — Forward to backend service with metadata (user_id, role, correlation_id, trace).

---

## 2. Policy matrix (RPC → role + ownership)

| RPC / resource        | Required role | Ownership check              | Notes                    |
|-----------------------|---------------|-----------------------------|--------------------------|
| CreateListing         | landlord      | `sub == user_id` in request | Caller is listing owner   |
| GetListing, SearchListings | any      | —                           | Public read               |
| CreateBooking         | tenant        | `sub == tenant_id` in request| Caller is tenant          |
| ConfirmBooking, CancelBooking | landlord | `sub == landlord_id` for booking | Or tenant for cancel |
| GetBooking            | tenant, landlord | booking.tenant_id or landlord_id == sub | Own booking only |
| FlagListing           | any           | authenticated                | Any logged-in user        |
| SubmitReview          | tenant        | completed booking for caller | Trust validates booking  |
| GetReputation         | any           | authenticated                |                          |
| SendMessage, GetConversation | any    | participant in conversation  | Must be in conversation  |
| GetUserPreferences    | any           | `sub == user_id`             | Own preferences only      |
| GetDailyMetrics       | admin         | —                           | Read-only analytics       |
| Register, Login       | —             | —                           | Public                    |
| ValidateToken         | internal / gateway | —                        | Not exposed to clients    |

**Ownership check:** Gateway may pass `sub` and let the backend enforce; or gateway resolves entity (e.g. fetch booking) and denies if `sub` not in tenant_id/landlord_id. Prefer backend enforcement for complex rules; gateway can do coarse checks.

---

## 3. Correlation and tracing

- **x-correlation-id:** Generated at gateway if missing; propagated in gRPC metadata and Kafka headers.
- **Trace propagation:** W3C `traceparent` / `tracestate` in HTTP and gRPC metadata; Kafka producer adds same to message headers so consumers continue the trace.
- **Structured logging:** Every log line includes `correlation_id`, `service`, `entity_id` (when applicable), `event_type` (e.g. `booking.confirmed`).

---

## 4. Resume line

*Built policy-enforced API gateway with role-based and ownership-based authorization, TLS termination, JWT verification, rate limiting, and correlation/trace propagation.*
