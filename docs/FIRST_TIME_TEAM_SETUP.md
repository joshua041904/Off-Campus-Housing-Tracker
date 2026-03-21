# First-time setup (green team)

Follow this order once per machine. You can stop after the step that matches your role (e.g. only infra, or full preflight).

## 0. Prereqs

- Docker, `kubectl`, `kustomize` (or `kubectl kustomize`), `pnpm`, Node 20+, Colima (macOS) or another k3s/k8s cluster.

## 0a. One-shot stack (recommended)

Runs Colima → Docker infra → dev certs (if missing) → strict TLS bootstrap → DB bootstrap → Kafka topics + partition check → build/load images → `deploy-dev.sh` → housing secret bundle → event-layer Vitest/contracts.

```bash
./scripts/setup-full-off-campus-housing-stack.sh
# Full preflight + all suites (heavy):
RUN_PREFLIGHT=1 ./scripts/setup-full-off-campus-housing-stack.sh
```

Skip steps with `SKIP_COLIMA=1`, `SKIP_DB_BOOTSTRAP=1`, `SKIP_BUILD_IMAGES=1`, etc. See the script header.

## 1. Kubernetes + MetalLB

```bash
./scripts/setup-new-colima-cluster.sh
```

MetalLB is included/invoked from this flow; override pool with `METALLB_POOL` if your network needs it.

## 2. External infra (Postgres, Redis, Kafka, …)

```bash
./scripts/bring-up-external-infra.sh
```

- To **restore from a dump**, set the env vars documented at the top of `scripts/bring-up-external-infra.sh` (or your team’s `.env.restore` pattern).
- Postgres ports are domain-split (e.g. bookings on **5443** per `infra/k8s/base/config/app-config.yaml`); keep `app-config` in sync with what you run.

## 3. Databases & Kafka

```bash
./scripts/bootstrap-all-dbs.sh
# Analytics projection tables / engagement:
PGPASSWORD=postgres psql "postgresql://postgres@127.0.0.1:5447/analytics" -f infra/db/04-analytics-watchlist-engagement.sql
ENV_PREFIX=dev ./scripts/create-kafka-event-topics.sh
```

## 4. TLS / certs

Strict TLS and service mTLS must match your edge (Caddy/Envoy) and in-cluster secrets. See `docs/CERTS_AND_TESTING_FOR_MORTALS.md`.

## 5. Images + deploy

```bash
./scripts/build-housing-images-k3s.sh
./scripts/deploy-dev.sh
```

If pods are missing (e.g. **listings-service**), run:

```bash
./scripts/verify-required-housing-pods.sh STRICT=1
```

## 6. One-shot verification

```bash
./scripts/ensure-ready-for-preflight.sh
./scripts/run-preflight-scale-and-all-suites.sh
```

Event-layer only (Vitest + proto/topic contracts + optional Kafka partition describe + optional k6):

```bash
./scripts/run-event-layer-verification.sh
# or: pnpm run test:event-layer
```

Preflight includes **housing pod verification**, **event-layer-verification** (Vitest), messaging/media tests, protocol suites, and more — see `scripts/run-preflight-scale-and-all-suites.sh`.

## 7. Deep transport analysis (optional)

After packet captures and `SSLKEYLOGFILE`:

```bash
chmod +x ./scripts/master-transport-analysis.sh
./scripts/master-transport-analysis.sh
```

---

Canonical narrative also lives in `docs/RUN_PIPELINE_ORDER.md`.
