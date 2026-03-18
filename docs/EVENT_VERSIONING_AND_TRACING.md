# Event Versioning, Schema Registry, Distributed Tracing, and Replay

Single doc for **event envelope**, **versioning rules**, **Protobuf event contracts**, **OpenTelemetry tracing**, and **replay/rebuild strategy**. Resume-grade, architect-tier.

---

## 1. Event versioning (professional evolution model)

**Core rule:** Events are immutable. New meaning ⇒ new version. Never mutate old meaning.

### 1.1 Event envelope (required)

Every Kafka message payload must be an envelope:

```json
{
  "event_id": "uuid",
  "type": "booking.confirmed",
  "version": 1,
  "source": "booking-service",
  "entity_id": "booking-uuid",
  "timestamp": "2025-03-17T12:00:00Z",
  "data": { ... }
}
```

- **event_id:** Unique per event; used for idempotent dedup (`processed_events`).
- **type:** Event type (e.g. `booking.confirmed`).
- **version:** Schema version of `data`; consumers `switch (version)` to handle.
- **source:** Producing service name.
- **entity_id:** Entity used as partition key (booking_id, listing_id, etc.).
- **timestamp:** ISO-8601.
- **data:** Versioned payload.

### 1.2 Backward-compatible changes (same version)

Allowed without bumping version:
- Add optional field.
- Add nullable field.
- Add metadata.

Example: add `booking_source: "mobile"` to existing v1 payload ⇒ still version 1.

### 1.3 Breaking changes (new version)

If you remove field, rename field, or change meaning:
- Keep same topic and type; **increment version** (e.g. `version: 2`).
- Consumers implement `handleV1(event)` and `handleV2(event)`; default to latest.

### 1.4 Consumer strategy

```text
switch (event.version) {
  case 1: handleV1(event.data); break;
  case 2: handleV2(event.data); break;
  default: log and skip or handle as latest;
}
```

Evolve without breaking existing consumers.

---

## 2. Schema registry strategy (Protobuf event contracts)

Even without Confluent Schema Registry, **define event payloads in Protobuf** so producers and consumers compile against a shared contract.

- **Location:** `proto/events/` — e.g. `booking.proto`, `trust.proto`, `listing.proto`, `messaging.proto`.
- **Content:** Versioned messages, e.g. `BookingConfirmedV1`, `BookingConfirmedV2`.
- **Compatibility:** Backward compatible only; never break existing consumers.
- **Build:** Generate code for producers/consumers; validate payloads at produce/consume time.

**Resume line:** *Implemented Protobuf-based contract validation for Kafka event schemas with versioned compatibility discipline.*

---

## 3. Distributed tracing (OpenTelemetry)

### 3.1 Correlation model

- Every request gets **x-correlation-id** (gateway generates if missing).
- Flow: Client → Gateway → Service → Kafka → Analytics.
- All logs: `correlation_id`, `entity_id`, `event_type`, `service`.

### 3.2 Trace propagation

- **gRPC:** Inject W3C `traceparent` / `tracestate` in metadata; extract in backend.
- **Kafka:** Producer adds headers: `correlation_id`, `trace_id` (and optionally `span_id`). Consumers propagate and create child spans.
- **OpenTelemetry:** Each service uses gRPC interceptor + Kafka producer/consumer wrappers; export to Jaeger (dev) or OTLP collector.

### 3.3 Resume line

*Implemented distributed tracing across gRPC and Kafka boundaries using OpenTelemetry with correlation propagation.*

---

## 4. Replay / rebuild strategy (analytics projections)

### 4.1 Why replay

- Projections can drift; bugs happen; metric definitions change.
- Deterministic rebuild from event log gives correct state.

### 4.2 Replay flow

Analytics service supports **REPLAY_FROM_BEGINNING=true** (or equivalent):

1. Clear projection tables (`daily_metrics`, `user_activity`, and any other read-model tables).
2. Optionally clear `projection_state` and `processed_events` for a full replay.
3. Seek Kafka consumer to offset 0 (or start of retention).
4. Reprocess all events (idempotent by `event_id`); rebuild projections.
5. Update `projection_versions` when projection logic version changes.

### 4.3 Projection versioning

- **analytics.projection_versions:** `name`, `version`, `updated_at`.
- When projection logic changes: increment `version`, run replay, update row.
- Enables “replayable event projections with deterministic rebuild and projection version control.”

### 4.4 Resume line

*Designed replayable event projections supporting deterministic rebuild and projection version control.*

---

## 5. CQRS-style language

- **Write model** → domain DB (e.g. booking DB).
- **Event model** → Kafka (immutable envelope + versioned data).
- **Read model** → analytics DB (daily_metrics, user_activity, etc.).

*Implemented CQRS-inspired architecture with Kafka-backed projections.*
