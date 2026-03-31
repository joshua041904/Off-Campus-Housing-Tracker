# Messaging service hardening checklist (single-pod first)

Use this before increasing replicas or HPA. Goal: **stable one pod** under k6 / edge load.

## Done in repo (baseline)

- [x] HTTP concurrency guard (`createHttpConcurrencyGuard`) — default ceiling raised to **200**; override with `MESSAGING_HTTP_MAX_CONCURRENT`.
- [x] DB pool `max` **50** + concurrency guard aligned to pool (`services/messaging-service/src/lib/db.ts`).
- [x] Liveness probe relaxed (longer timeouts, higher `failureThreshold`, slower period) to reduce restarts under CPU pressure (`infra/k8s/base/messaging-service/deploy.yaml`).
- [x] `GET /healthz` mounted **before** concurrency guard so probes stay cheap.

## Verify under load

1. During k6 limit finder: `kubectl get pods -n off-campus-housing-tracker -l app=messaging-service -w` — note **RESTARTS**.
2. If restarts increase: `kubectl describe pod -n off-campus-housing-tracker -l app=messaging-service` — **OOMKilled**, **Liveness failed**, **Readiness failed**.
3. `kubectl logs -n off-campus-housing-tracker deploy/messaging-service --tail=200` — Kafka connect errors vs DB timeouts.

## Kafka producers (if any await in hot path)

- Prefer `producer.send(...).catch(log)` or a bounded queue; do not block forum/message handlers on Kafka ack unless required for correctness.

## Optional tuning

| Knob | Purpose |
|------|---------|
| `MESSAGING_HTTP_MAX_CONCURRENT` | Raise/lower 503 `server_busy` threshold |
| `HTTP_CONCURRENCY_VEGAS=1` | Adaptive cap from observed p95 (common utils) |
| `DB_POOL_MAX` / `MAX_DB_CONCURRENCY` | Align pool with Postgres `max_connections` budget |
| gRPC-only health | HTTP `/healthz` is separate from gRPC readiness; gateway should hit the same surface it uses for user traffic |

## When stable at ~150–200 VUs single pod

- Consider **replicas: 2** and eventual HPA on CPU + custom `och_http_inflight` (once exported).
