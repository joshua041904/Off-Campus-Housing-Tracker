# Run order — Colima, infra, images, deploy, tests

Use this as the **canonical sequence** for a full local housing stack. Adjust timeouts if your machine is slow.

**Onboarding:** see also [FIRST_TIME_TEAM_SETUP.md](./FIRST_TIME_TEAM_SETUP.md) for a narrative aimed at new teammates.

## 0. One command (orchestrates 1–7 below)

```bash
./scripts/setup-full-off-campus-housing-stack.sh
RUN_PREFLIGHT=1 ./scripts/setup-full-off-campus-housing-stack.sh   # adds full preflight + suites
```

Uses **`HOUSING_NS`** only (does not honor stray `NS=` from other repos). See script header for `SKIP_*` flags.

## 1. Cluster (MetalLB pool auto-detected unless `METALLB_POOL` is set)

```bash
./scripts/setup-new-colima-cluster.sh
```

Creates Colima + k3s, namespaces, **MetalLB** (pool from `install-metallb-colima.sh`, often `192.168.64.x` on Colima). Ends with **“Done”** and next-step hints.

## 2. External infra (Postgres 5441–5448, Redis 6380, Kafka 29094, …)

```bash
./scripts/bring-up-external-infra.sh
```

Requires Docker; Kafka needs `certs/kafka-ssl/`. Prints **step X / Y** milestones.

## 3. DB schemas (first time or after reset)

```bash
./scripts/bootstrap-all-dbs.sh
# or per-domain: PGPASSWORD=postgres psql … -f infra/db/01-*.sql
```

Apply analytics extensions: `infra/db/04-analytics-watchlist-engagement.sql` after `01`–`03` analytics SQL.

## 4. Kafka topics

```bash
ENV_PREFIX=dev ./scripts/create-kafka-event-topics.sh
./scripts/verify-proto-events-topics.sh
```

## 5. TLS / secrets (if not already)

Follow `docs/LOCAL_TLS_AND_TESTING_GUIDE.md` or your strict-tls bootstrap so **Caddy**, **Envoy**, and **service mTLS** match.

## 6. Build & load images into Colima/k3s

```bash
./scripts/build-housing-images-k3s.sh
```

Builds `*:dev` and `docker save | colima ssh docker load`.

## 7. Deploy manifests

```bash
./scripts/deploy-dev.sh
```

Waits for core deployments (including **analytics-service**).

## 8. Wiring & unit checks

```bash
pnpm run test:housing-wiring
```

## 9. Protocol / edge tests (HTTP/2, HTTP/3, gRPC)

- Standalone capture: `./scripts/test-packet-capture-standalone.sh`
- Wrapped suite: `./scripts/run-suite-with-packet-capture.sh ./scripts/test-listings-http2-http3.sh`
- See `docs/TESTING_PROTOCOLS.md` and `scripts/lib/COHERENT_ANALYSIS.md`

### k6 — all housing edge paths (p95 + max / “p100” report + graph)

After TLS CA exists (`certs/dev-root.pem`):

```bash
K6_CA_ABSOLUTE="$PWD/certs/dev-root.pem" ./scripts/load/run-k6-all-services.sh
```

Writes under `bench_logs/k6-all-services-*`: per-run `*-summary.json`, **`latency-report.md`**, **`latency-graph.html`**. Includes **`k6-event-layer-adversarial.js`** (edge + messaging/booking health + light adversarial traffic).

### Redis Lua vs plain (throughput chart)

After Redis is up on **6380** and `pnpm install` has populated `services/common/node_modules`:

```bash
pnpm run bench:redis-lua
# or: ./scripts/benchmark-redis-lua-vs-plain.sh
```

Outputs **`bench_logs/redis-lua-bench-*/results.csv`** and **`comparison-chart.html`** (Lua `EVAL` vs GET+INCRBY+PEXPIRE, same semantics as `services/common/src/redis-lua.ts`).

### Verify deployments (correct namespace)

Do **not** rely on a stray `NS=` from another project. This repo uses **`HOUSING_NS`** (default `off-campus-housing-tracker`):

```bash
./scripts/verify-required-housing-pods.sh
# or: HOUSING_NS=my-namespace ./scripts/verify-required-housing-pods.sh
```

## 10. Webapp / e2e (optional)

```bash
pnpm run test:webapp:e2e
```

---

**Ollama (optional):** run Ollama on the host or in-cluster; set **`OLLAMA_BASE_URL`** on **analytics-service** for listing “feel” analysis.
