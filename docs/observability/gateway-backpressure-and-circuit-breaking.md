# Gateway backpressure and circuit breaking (api-gateway + Caddy)

## Current building blocks (code)

### api-gateway (`services/api-gateway`)

- **Global rate limit** — `express-rate-limit` in `server.ts` (tunable; auth routes exempt).
- **Proxy in-flight cap** — `proxyInflightMiddleware` in `proxy-limits.ts`: returns **503** `{ error: "overloaded", code: "gateway_backpressure" }` when concurrent proxied requests exceed the configured max.
- **Analytics GET coalescing** — `analyticsDailyMetricsCoalescedHandler`: identical `daily-metrics` queries share one upstream fetch (reduces thundering herd).
- **E2E traffic shaping** — `e2e-traffic-shaper.ts` / `e2e-test-mode-inflight-cap.ts` for labeled test traffic.

### Edge (Caddy)

- Caddy terminates HTTP/2 and HTTP/3; it does **not** expose the same programmatic per-route circuit breaker as Envoy.
- Protection at the edge today: **timeouts**, **max request body**, and **upstream health** via passive failures. For strict per-upstream CB, consider **Envoy** in front of services or **application-level** guards (already in gateway and services).

## Recommended configuration direction

1. **Per-upstream timeouts** in gateway proxy client (connect + response) — fail fast before pod queues explode.
2. **Cap concurrent upstream calls per route** (stricter than global proxy inflight for hot routes like messaging health vs heavy POST).
3. **503 + `Retry-After`** on overload (already pattern in service guards); document clients must backoff.
4. **Document HTTP/2 anomaly** — high p95 on H2 with low p95 on H/3 and H1 often indicates **multiplexing + head-of-line** at gateway or Node; mitigations: smaller per-connection concurrency in k6, larger service pools, non-blocking Kafka, and edge limits.

## Env vars to document in deploy

- Any `GATEWAY_*` / `PROXY_*` inflight caps once split from defaults in `server.ts`.
- Rate limit window and max documented next to `limiter` config.
