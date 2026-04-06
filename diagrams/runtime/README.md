# Runtime / data-flow diagrams

The **sync + async topology** (Caddy, gateway, services, Kafka brokers, Postgres) is generated from curated JSON:

- `make generate-diagrams` → `diagrams/flow/data-flow.svg` + **`diagrams/data-modeling/png/data-flow.png`**
- Optional broker health: `KAFKA_BROKER_STATUS_JSON` (see `scripts/diagram/data/kafka-broker-status.prometheus-notes.md`)
