# Service-to-Service Auth (mTLS + Identity) and Uniform Error Handling

Single reference for **internal auth** and **error contracts**. No plaintext, no vibes — coherent and stable.

---

## Part 1 — Service-to-service auth (mTLS + internal identity)

### Layer 1 — mTLS is mandatory

- All internal service-to-service calls: **gRPC over TLS**; **client certificate required**.
- Kafka broker: **ssl.client.auth=required**; no plaintext ports.
- K8s/Colima: each service gets its own client cert, signed by dev root CA, mounted as secret.
- **No fallback.** No “just for dev” plaintext. No exceptions.

### Layer 2 — Internal service identity

mTLS proves “this is booking-service” but not “is booking-service allowed to call trust-service?” So we add identity discipline.

- **Header:** Gateway and internal callers inject **x-service-name** (e.g. `booking-service`).
- **Validation:** Server interceptor checks:
  - Cert subject (CN) matches the service identity.
  - Header `x-service-name` matches certificate CN.
- **Mismatch → reject.** No spoofed service calls; no pretending to be another service.

### Layer 3 — Service capability matrix

Who is allowed to call whom (gRPC). Enforce in interceptor or policy layer.

| Service       | Allowed to call (gRPC)     |
|---------------|----------------------------|
| gateway       | all                        |
| booking       | trust, listings            |
| listings      | (as needed; e.g. none)     |
| trust         | none (async / Kafka only)  |
| analytics     | none (consumer only)       |
| notification  | none (consumer only)        |
| messaging     | (as needed)                 |
| auth          | (validated by gateway only) |

Adjust rows as you add calls; the principle is: **explicit allow-list per service**, not “everyone can call everyone.”

**Resume line:** *Implemented zero-trust internal service authentication using mTLS with service-identity validation and capability enforcement.*

---

## Part 2 — Uniform error handling

### Rule 1 — Use gRPC status codes correctly

| Scenario           | gRPC code           |
|--------------------|---------------------|
| Validation error   | INVALID_ARGUMENT    |
| Missing resource   | NOT_FOUND           |
| Auth failure      | UNAUTHENTICATED     |
| Role / permission | PERMISSION_DENIED   |
| Conflict           | ALREADY_EXISTS      |
| Internal bug       | INTERNAL            |

- **Never** use INTERNAL for validation or expected business errors.
- **Never** return OK with an embedded error payload. Error ⇒ gRPC error.

### Rule 2 — Structured error payload

When returning a gRPC error, attach structured detail when it helps the client:

```json
{
  "code": "INVALID_ARGUMENT",
  "message": "Invalid booking state",
  "details": [
    { "field": "status", "issue": "Cannot transition from COMPLETED to CREATED" }
  ]
}
```

Use gRPC trailing metadata or a standard error-detail extension (e.g. Google API style); keep the shape consistent. Align with **common.proto** `ErrorResponse` / `ErrorDetail` where applicable.

### Rule 3 — No boolean “success” flags

- Do **not** add `bool success = 1` to responses.
- On error: **return a gRPC error.** Do not mix success and error in the same response type.

### Rule 4 — Error logging discipline

On every error, log a structured line, e.g.:

```json
{
  "level": "error",
  "correlation_id": "...",
  "service": "booking-service",
  "grpc_code": "INVALID_ARGUMENT",
  "entity_id": "booking-uuid"
}
```

Uniform, traceable, searchable. No stack traces or internal DB messages in client-facing responses.

### What we do NOT do

- ❌ Custom error types per service (use standard gRPC codes + shared detail shape).
- ❌ Random HTTP-style codes inside gRPC.
- ❌ Embedding stack traces in responses.
- ❌ Exposing raw internal or DB errors to clients.

Sanitized, standardized, predictable.

---

## Summary

- **Auth:** mTLS everywhere; x-service-name + cert CN validation; capability matrix enforced in interceptors.
- **Errors:** gRPC status only; structured details when needed; no success flags; consistent error logging; no internal leakage.

This is the final state. No extra layers, no Saga, no chaos testing, no enterprise cosplay. Clean, sharp, done.
