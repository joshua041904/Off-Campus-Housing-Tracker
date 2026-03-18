# Event contracts (Kafka payloads)

Versioned Protobuf messages for Kafka event **data** field. Envelope (event_id, type, version, source, entity_id, timestamp) is defined in docs; producers/consumers use these for strong typing and compatibility.

- **booking.proto** — BookingConfirmedV1, BookingCreatedV1, BookingCancelledV1, BookingCompletedV1.
- Add **listing.proto**, **trust.proto**, **messaging.proto** as needed with same discipline: backward compatible only; new version for breaking changes.

See docs/EVENT_VERSIONING_AND_TRACING.md and docs/KAFKA_STRATEGY.md.
