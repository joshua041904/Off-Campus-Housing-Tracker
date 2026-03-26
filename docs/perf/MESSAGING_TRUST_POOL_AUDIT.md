# Messaging + trust — pool / concurrency audit (perf)

Use this when **protocol comparison** shows high tail on **HTTP/1.1** but not **HTTP/2**, or when **waiting** dominates **sending** in k6 summary metrics — often **connection churn → pool pressure**, not raw CPU.

## Checklist

| Area | What to verify | Where to look |
|------|----------------|---------------|
| Postgres pool | `max` connections, idle timeout, acquire timeout | `services/messaging-service` / `trust-service` DB client init (`pg` `Pool` options), env vars in k8s manifests |
| Redis | connection pool / client reuse | messaging/trust Redis usage, if any |
| Promise fanout | unbounded `Promise.all` on large arrays | route handlers, gRPC handlers |
| Long transactions | `BEGIN` held across network calls | DB layers |
| N+1 | loop + per-row query | repositories |
| Sync JSON / crypto | large body parse on hot path | middleware |

## k6 signals

- **`http_req_waiting` p(95) ≫ `http_req_sending` p(95)** → time in **server / queue / DB**, not TLS/write overhead.
- **`K6_HTTP2_DISABLE_REUSE=1`** on messaging matrix: if tail **explodes** vs reuse on, suspect **connection count × pool** interaction on **H1/H2** paths.

## Output table (per finding)

| Service | Symptom | Likely layer | Evidence | Change |
