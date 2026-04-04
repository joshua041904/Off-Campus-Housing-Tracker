# Kafka broker health → `kafka-broker-status.json`

The data-flow diagram colors each broker hexagon from optional **`KAFKA_BROKER_STATUS_JSON`**.

## Health values

| Value | Meaning | Fill color |
|-------|---------|------------|
| `stable` | Leader steady, low controller churn | Green |
| `election_heavy` | Elevated leader elections (e.g. &gt; 1/min sustained) | Orange |
| `flapping` | Repeated / rapid elections or broker instability | Red |
| `unknown` | No signal (default if key missing) | Neutral amber |

## Flat JSON (preferred for scripts)

```json
{
  "kb0": "stable",
  "kb1": "election_heavy",
  "kb2": "flapping"
}
```

## Nested form (also accepted)

```json
{
  "brokers": {
    "kb0": { "health": "stable", "elections_per_min": 0.1 },
    "kb1": { "health": "election_heavy", "elections_per_min": 2.4 }
  }
}
```

## Wiring Prometheus

Exporters and metric names differ (Strimzi, JMX exporter, kube-prometheus, etc.). Typical pattern:

1. Run an **instant query** per broker or aggregate (e.g. `rate(kafka_controller_controllerstats_uncleanleaderelections_total[1m])` — **verify** against your scrape config).
2. Map query results to `stable` / `election_heavy` / `flapping` thresholds in a small script.
3. Emit the flat JSON file and run:

```bash
export KAFKA_BROKER_STATUS_JSON=/path/to/kafka-broker-status.json
make generate-diagrams
```

See `scripts/diagram/fetch-kafka-broker-status-stub.sh` for a placeholder that writes example JSON (replace with your query logic).
