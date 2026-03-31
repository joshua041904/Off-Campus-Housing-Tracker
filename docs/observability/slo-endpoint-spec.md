# Per-endpoint SLO spec (draft)

Aggregating whole-service p95 hides failures on critical routes (e.g. **GET /healthz** vs **POST /messages**). This doc defines **classes** and example thresholds; tune from production percentiles.

## Class A — public / health reads

| Route | p95 | p99 | error rate |
|-------|-----|-----|------------|
| GET `/api/messaging/healthz` (via gateway) | &lt; 50 ms | &lt; 200 ms | &lt; 0.1% |
| GET listings search (cached / indexed path) | &lt; 300 ms | &lt; 800 ms | &lt; 0.5% |
| GET analytics `daily-metrics` | &lt; 300 ms | &lt; 800 ms | &lt; 0.5% |

## Class B — authenticated writes

| Route | p95 | p99 | error rate |
|-------|-----|-----|------------|
| POST listings create | &lt; 500 ms | &lt; 1200 ms | &lt; 1% |
| POST messaging messages | &lt; 300 ms | &lt; 1000 ms | &lt; 1% |

*Note:* Listings create may relax p95 when **synchronous** analytics ingest is enabled (`ANALYTICS_SYNC_MODE=1`); with **Kafka fire-and-forget** (`LISTINGS_KAFKA_AWAIT_PUBLISH=false`), prefer Class B targets above for TTFB.

## Class C — eventual / pipeline

| Flow | SLO |
|------|-----|
| Listing created → `daily_metrics` updated | Consistency window **&lt; 60 s** (not hard latency) |
| Kafka consumer lag | Alert if sustained &gt; N minutes per topic |

## Enforcement

1. k6 scripts should tag scenarios by **route** and evaluate thresholds per tag (not only service aggregate).
2. Playwright integrity tests should use **Class C** windows for cross-service assertions (or rely on `ANALYTICS_SYNC_MODE=1` for deterministic E2E).
3. Prometheus: `och_http_slo_breach_total{route="..."}` — see `prometheus-metrics-schema.md`.

## Versioning

Bump the **Last updated** line when thresholds change.

Last updated: 2026-03-30
