# Listings HTTP — request timing diagnostics

Use this to separate **DB time** vs **full request time** when k6 shows multi-second tails while `EXPLAIN` is sub-millisecond.

## Enable (local / process)

```bash
export LISTINGS_HTTP_TIMING=1
# optional: log every request (not only slow)
export LISTINGS_HTTP_TIMING_MIN_MS=0
# default: only log requests with total time >= 1000 ms
export LISTINGS_HTTP_TIMING_MIN_MS=1000
# log pg pool stats every N ms (requires LISTINGS_HTTP_TIMING=1)
export LISTINGS_HTTP_POOL_STATS_MS=2000
# log search handler DB phase when dbMs >= 50 (default)
export LISTINGS_HTTP_SEARCH_DB_MIN_MS=50
```

## Kubernetes

```bash
kubectl set env deployment/listings-service -n off-campus-housing-tracker \
  LISTINGS_HTTP_TIMING=1 \
  LISTINGS_HTTP_POOL_STATS_MS=2000
kubectl rollout status deployment/listings-service -n off-campus-housing-tracker
```

Turn off after debugging:

```bash
kubectl set env deployment/listings-service -n off-campus-housing-tracker LISTINGS_HTTP_TIMING- LISTINGS_HTTP_POOL_STATS_MS-
```

## Log lines

| Prefix | Meaning |
|--------|--------|
| `[listings-http-timing]` | Total time from request start to `res.finish` (includes JSON serialize, backpressure). Tag `SLOW_TIMEOUT_CLASS` when **≥ 5000 ms**. |
| `[listings-http-search-db]` | Time inside `pool.query` for browse/search only. |
| `[listings-pool]` | `total` / `idle` / `waiting` from `pg` Pool. **`waiting > 0`** suggests pool starvation under load. |

## Interpret

- **`search-db` ms low, timing ms high** → stall is not Postgres query execution (gateway, proxy, CPU, event loop, client).
- **`waiting` spikes** → increase `max` in `services/listings-service/src/db.ts` carefully vs Postgres `max_connections`.
- **Flat ~5000 ms** → align with upstream timeouts (Envoy, gateway, axios); see service logs and `grpc-health-probe` **5s** timeouts on the same pod (probes are gRPC, not HTTP browse).

## k6

```bash
# Terminal 1 — confirm pod has timing code: you should see one startup line after rollout:
#   [listings-http-timing] enabled minMs=1000 ...
kubectl logs -n off-campus-housing-tracker deployment/listings-service --tail=50 | grep listings-http-timing

# Follow (optional: no grep first, to see startup line)
kubectl logs -f -n off-campus-housing-tracker deployment/listings-service 2>&1 | grep -E 'listings-http-timing|listings-http-search-db|listings-pool'

# Terminal 2 — BASE_URL defaults to https://off-campus-housing.test in k6-strict-edge-tls.js
SSL_CERT_FILE=$PWD/certs/dev-root.pem k6 run scripts/load/k6-listings-health.js
```

**Empty grep?** (1) **Rebuild/redeploy** the listings image after pulling code — env vars alone do not inject logging if the container still runs an old image. (2) **`/healthz` is usually &lt; 1000 ms** — you will only see `[listings-http-timing] SLOW …` when `LISTINGS_HTTP_TIMING_MIN_MS` is exceeded. To log **every** request: `LISTINGS_HTTP_TIMING_MIN_MS=0`. (3) Hit **search** to exercise DB + middleware:  
`k6 run -e BASE_URL=https://off-campus-housing.test scripts/load/k6-listings-ramp.js` (or `k6-listings.js`).

Health path is `GET /api/listings/healthz` → still passes through middleware (logs when over `minMs`).

## Troubleshooting

### k6: `BASE_URL must be an https URL`

Your `scripts/load/k6-strict-edge-tls.js` is **out of date** (or you are not in the repo root). **Pull latest**, or run:

```bash
grep -q 'off-campus-housing.test' scripts/load/k6-strict-edge-tls.js && echo OK || echo "update k6-strict-edge-tls.js"
```

`k6-listings-health.js` also falls back if `defaultRawBase()` throws. As a last resort:

```bash
k6 run -e BASE_URL=https://off-campus-housing.test scripts/load/k6-listings-health.js
```

### kubectl: no `[listings-http-timing]` lines

1. **Confirm env in the running pod** (must be `1`):

   ```bash
   kubectl exec -n off-campus-housing-tracker deploy/listings-service -c app -- printenv LISTINGS_HTTP_TIMING
   ```

2. **Confirm the image includes the diagnostics** — setting env alone does not change compiled code. After pulling the repo, **rebuild and reload** the image referenced by the deployment (often `listings-service:dev`):

   ```bash
   docker build -f services/listings-service/Dockerfile -t listings-service:dev .
   # Then load into your cluster (Colima/k3d/minikube) and restart, e.g.:
   kubectl rollout restart deployment/listings-service -n off-campus-housing-tracker
   ```

3. After restart, you should see **one** startup line containing `[listings-http-timing] enabled` in:

   ```bash
   kubectl logs -n off-campus-housing-tracker deployment/listings-service -c app --tail=200
   ```

   If it never appears, the container is still running an **old** image without this logging.
