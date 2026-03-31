# Prometheus metrics schema (housing services)

Version-controlled target for **per-service** and **per-route** observability. Implement incrementally; names follow Prometheus conventions (`snake_case` suffix `_total`, `_seconds`, `_bytes`).

## Global labels (apply on scrape or via `prom-client`)

| Label | Example | Notes |
|--------|---------|--------|
| `service` | `listings-service` | Stable k8s deploy name |
| `route` | `GET /search` | Normalized path template, not raw IDs |
| `method` | `GET` | HTTP method |
| `status_class` | `2xx`, `4xx`, `5xx`, `timeout` | Derived from status or timeout |

## Counters

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `och_http_requests_total` | counter | `service`, `route`, `method`, `status_class` | Completed HTTP responses |
| `och_http_slo_breach_total` | counter | `service`, `route`, `slo_class` | Response exceeded configured SLO latency for class A/B |
| `och_overload_reject_total` | counter | `service`, `component` | 503 from concurrency guard (`http`, `gateway`) |
| `och_db_pool_reject_total` | counter | `service` | Query rejected / timed out waiting for pool |
| `och_kafka_publish_total` | counter | `service`, `topic`, `result` | `result` = `ok` \| `error` |
| `och_kafka_consume_total` | counter | `service`, `topic`, `result` | Consumer handler outcome |

## Histograms (latency)

| Metric | Type | Labels | Buckets (suggested ms) |
|--------|------|--------|-------------------------|
| `och_http_request_duration_seconds` | histogram | `service`, `route`, `method` | `5,10,25,50,100,250,500,1000,2500` |
| `och_db_query_duration_seconds` | histogram | `service`, `query_name` | Same |
| `och_kafka_publish_duration_seconds` | histogram | `service`, `topic` | Same |

## Gauges

| Metric | Labels | Meaning |
|--------|--------|---------|
| `och_http_inflight` | `service` | Current concurrent HTTP requests (after guard) |
| `och_db_pool_in_use` | `service` | Connections checked out |
| `och_kafka_consumer_lag` | `service`, `topic`, `partition` | Optional; from burrow/admin or estimated |

## Gateway-specific

| Metric | Notes |
|--------|--------|
| `och_gateway_proxy_inflight` | Mirror of in-flight cap in `proxyInflightMiddleware` |
| `och_gateway_rate_limit_hits_total` | If split from `express-rate-limit` |

## Error taxonomy (log + optional counter)

Map failures to `status_class` or a dedicated `och_error_type` label:

- `client_error` (4xx)
- `server_error` (5xx)
- `timeout`
- `overload_reject`
- `db_pool_exhausted`
- `kafka_unavailable`

Structured JSON logs should include the same `route` normalization as metrics for joinability in Loki/Elastic.
