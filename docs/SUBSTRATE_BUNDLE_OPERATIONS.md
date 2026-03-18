# Substrate bundle: what’s included, what’s left out, how to operate

This document describes the **portable substrate tarball** produced by `scripts/build-substrate-bundle.sh`: what is inside, what is **record-platform–specific and left out**, how to run it, and what to add for your project (e.g. **housing-platform** with 7 domain services per the global-scale spec).

**Separate repo:** The bundle is an **extra copy** for use in a **different project repository**. Build from record-platform, then extract the tarball in the other repo (e.g. housing); do not merge into record-platform. Use a project name to get a distinct tarball: `./scripts/build-substrate-bundle.sh substrate-bundle housing` → `substrate-bundle-housing.tar.gz`. See the bundle README for extract-and-merge steps.

**Create bundle at a fixed path (e.g. `/Users/tom/Off-Campus-Housing-Tracker`):**  
`BUNDLE_OUTPUT_ROOT=/Users/tom BUNDLE_FOLDER_NAME=Off-Campus-Housing-Tracker ./scripts/build-substrate-bundle.sh`  
The tarball is written as `$BUNDLE_OUTPUT_ROOT/$BUNDLE_FOLDER_NAME.tar.gz`. **Root docs in the bundle:** **README.md** = housing-specific project README (Off-Campus-Housing-Tracker overview, user cases, architecture, service breakdown); **ENGINEERING.md** and **Runbook.md** = same as RP with a **cluster-only focus** note prepended (Kubernetes, Caddy, Envoy, MetalLB, TLS, runbook). See **docs/SUBSTRATE_OPERATIONS_REPORT.md** §0 for details.

---

## 1. What’s in the tarball

- **Root:** `Caddyfile`, `docker-compose.yml` (Redis + Kafka + Zookeeper + Postgres; DB count per-project), **package.json**, **pnpm-workspace.yaml**, **pnpm-lock.yaml**, **tsconfig.base.json**, **.npmrc**, **README.md** (housing project overview; from `docs/housing-platform/README.md`), **ENGINEERING.md**, **Runbook.md** (cluster-only focus note prepended; see §0 in SUBSTRATE_OPERATIONS_REPORT.md).
- **infra/:** Copied from RP **except** `infra/db` and `infra/ansible`. Included: **infra/docs**, **infra/haproxy**, **infra/kafka**, **infra/nginx**, **infra/k8s**. So you get the full k8s substrate layout.
- **infra/k8s:** Top-level Caddy YAML, MetalLB, **overlays** (full). **base/** = **substrate only**: namespaces, config, kafka-external, kafka, envoy-test, redis, haproxy, nginx, observability, monitoring, exporters. **No** RP app services (api-gateway, auth-service, records-service, etc.) — add your own `base/<service>/` per app and register in **base/kustomization.yaml**. **base/README.md** explains. Overlay has **hpa-api-gateway.yaml** as template; add HPAs as you add services.
- **proto:** All `proto/*.proto` files (health, auth, and RP app protos as gRPC reference; replace with housing-specific protos as needed).
- **services:** `services/common`, `services/api-gateway`, `services/auth-service` (ported), `services/cron-jobs`, and **6 housing skeletons** (listings-service, booking-service, messaging-service, notification-service, trust-service, analytics-service). **webapp/** at repo root. **backups/:** Place or use `5437-auth.dump` for auth-service DB restore.
- **scripts:** TLS/Colima/MetalLB: `strict-tls-bootstrap.sh`, `rollout-caddy.sh`, `generate-envoy-client-cert.sh`, `colima-apply-host-aliases.sh`, `ensure-ready-for-preflight.sh`, `ensure-k8s-api.sh`, `get-pods-to-ready.sh`, `install-metallb.sh`, `verify-metallb-and-traffic-policy.sh`, `setup-new-colima-cluster.sh` (one-shot Colima + MetalLB; **set METALLB_POOL** per project).  
  Preflight and tests: `run-preflight-scale-and-all-suites.sh`, `test-microservices-http2-http3.sh`, `test-grpc-http2-http3.sh`, `test-http2-http3-strict-tls.sh`, `test-full-chain-with-rotation.sh`, `smoke-services.sh`.  
  Rotation/k6: `rotation-suite.sh`, `run-k6-chaos.sh`, `k6-chaos-test.js`; **scripts/load/run-k6-phases.sh** (k6 phases + optional xk6 HTTP/3; on Colima, host HTTP/3 is skipped). k6 load: `k6-http3-complete.js`, `k6-reads.js`, `k6-limit-test-comprehensive.js`, `k6-find-max-rps-http3.js`, `k6-http3-toolchain.js` (strict TLS via K6_CA_ABSOLUTE).  
  DB ops (portable, PGPASSWORD=postgres, report with timestamp): `backup-all-dbs.sh`, `inspect-external-db-schemas.sh`.  
  Kafka: `kafka-ssl-from-dev-root.sh` (broker + client certs when ssl.client.auth=required).  
  Helpers: `compare-h2-h3-headers.sh`, **scripts/lib/** (e.g. `http3.sh`, `packet-capture-v2.sh`, `kubectl-helper.sh`).
- **docs:** `SUBSTRATE_OPERATIONS_REPORT.md`, `SUBSTRATE_BUNDLE_OPERATIONS.md` (this file), **REPO_SETUP_SPEC.md** (in-depth: objective, root structure, service responsibilities, event-driven, DB policy, CI, Docker, security, scaling, phase 1 order, Cursor instruction block — what to build and how), **ARCHITECTURE.md**, **CURSOR_SCAFFOLD_INSTRUCTIONS.md**, **KAFKA_SUBSTRATE.md**, METALLB, STRICT_TLS_MTLS_AND_KAFKA, KAFKA_CURRENT_AND_ROADMAP, RUN-PREFLIGHT, XK6_HTTP3_SETUP, VERIFY_VS_PREFLIGHT_HTTP3.
- **certs:** Placeholder dir; add dev-root, leaf, envoy-client. **Kafka mTLS:** run `scripts/kafka-ssl-from-dev-root.sh` → `certs/kafka-ssl/` and kafka-ssl-secret in cluster.

---

## 2. What’s record-platform–specific (left out of bundle)

So the bundle stays **portable**, the following are **not** included; add your own equivalents in your repo:

- **Other application services:** The bundle includes `services/common`, `services/api-gateway`, `services/auth-service` (ported), `services/cron-jobs`, `webapp/`, and **6 housing skeletons** (listings, booking, messaging, notification, trust, analytics). RP-only services (records, shopping, social, auction-monitor, python-ai) are not included. Implement the 6 skeletons (see §4) using the same pattern as api-gateway and common; follow **docs/ARCHITECTURE.md** and **docs/CURSOR_SCAFFOLD_INSTRUCTIONS.md** in Cursor to scaffold.
- **Proto:** All RP `proto/*.proto` files are included as gRPC reference; replace or add housing-specific protos as needed.
- **RP DB schemas and migrations:** `infra/db/*.sql`. You add your own DB count (e.g. 7 DBs for the 7 domain services) and Prisma schemas per service.
- **RP-only scripts:** e.g. `ensure-shopping-order-number-sequence.sh`. Use `backup-all-dbs.sh` / `inspect-external-db-schemas.sh` with your own DB list (env or file).
- **infra/db and infra/ansible:** Not in bundle. DB schemas and Ansible are per-project.
- **K8s base app services:** Base is **substrate only** (no api-gateway, auth-service, etc.). You add `infra/k8s/base/<service>/` (deploy + service) for each of the 7 domain services and append to `base/kustomization.yaml`, then wire Caddy/Envoy to your gateway and backends.

---

## 3. How to operate the substrate

1. **New cluster (Colima + MetalLB)**  
   ```bash
   METALLB_POOL=192.168.64.240-192.168.64.250 ./scripts/setup-new-colima-cluster.sh
   ```  
   For **housing** (or another project), use a **different** pool to avoid conflict, e.g.:  
   `METALLB_POOL=192.168.64.251-192.168.64.260 ./scripts/setup-new-colima-cluster.sh`.

2. **TLS and Caddy**  
   Generate or copy CA + leaf; run `scripts/strict-tls-bootstrap.sh`, `scripts/generate-envoy-client-cert.sh`, then `scripts/rollout-caddy.sh` (with `CADDY_USE_LOADBALANCER=1` if using MetalLB).

3. **Preflight and suites**  
   `scripts/ensure-ready-for-preflight.sh` then `scripts/run-preflight-scale-and-all-suites.sh`. Override `NS` and `HOST` for your hostname/namespace.

4. **DB backup and schema report**  
   - Backup: `./scripts/backup-all-dbs.sh [backup-dir]` — uses `PGPASSWORD=postgres` (override with env), writes dumps and `backup-report-<timestamp>.md`.  
   - Inspect schemas: `./scripts/inspect-external-db-schemas.sh [report-dir]` — writes `schema-report-<timestamp>.md`.  
   Set `BACKUP_DBS` / `INSPECT_DBS` to a file or list (format `port:dbname:label`) for your DB layout (e.g. 10 DBs).

5. **K6 tests and xk6 HTTP/3**  
   Bundle includes `k6-chaos-test.js`, `scripts/load/run-k6-phases.sh` (phases + optional HTTP/3), and xk6 HTTP/3 scripts. Use **K6_CA_ABSOLUTE** (e.g. `certs/dev-root.pem`) for strict TLS. On Colima, host HTTP/3 is skipped automatically; in-cluster k6 and pod capture are authoritative. See docs/XK6_HTTP3_SETUP.md and docs/VERIFY_VS_PREFLIGHT_HTTP3.md.

6. **Kafka (strict TLS + mTLS + exactly-once)**  
   - **Strict TLS:** Broker SSL only on 9093; PLAINTEXT on 127.0.0.1 for healthcheck.  
   - **mTLS:** Docker Compose and in-cluster use **KAFKA_SSL_CLIENT_AUTH=required**. Run `scripts/kafka-ssl-from-dev-root.sh` after CA reissue; mount `kafka-ssl-secret` in every service. Set `KAFKA_CA_CERT`, `KAFKA_SSL_ENABLED`; add client cert env if your client lib supports mTLS.  
   - **Exactly-once:** Use idempotent producer (`enable.idempotence: true`) and consumer `isolation.level=read_committed` where needed. See docs/KAFKA_SUBSTRATE.md and docs/KAFKA_CURRENT_AND_ROADMAP.md.  
   - **kafka-external:** After `kubectl apply -k infra/k8s/overlays/dev`, patch the **kafka-external** Endpoints IP to your host (e.g. Colima gateway) so pods reach Docker Compose Kafka.

---

## 4. What to add: housing-platform (7 domain services)

Use the substrate as the base; follow **docs/ARCHITECTURE.md** and **docs/CURSOR_SCAFFOLD_INSTRUCTIONS.md** (paste the latter into Cursor to scaffold).

**In the bundle:** Auth-service is **ported** (full code); restore its DB from `backups/5437-auth.dump` (see backups/README.txt). The other **6 services** are **skeletons** (README per service); implement using common + api-gateway pattern. No cross-service DB access; cross-domain only via Kafka.

| # | Service | DB | In bundle |
|---|---------|-----|-----------|
| 1 | **auth-service** | auth | Ported (full). Restore from backups/5437-auth.dump. |
| 2 | **listings-service** | listings | Skeleton. Listings, geo, pricing, search, filtering. No booking logic. |
| 3 | **booking-service** | bookings | Skeleton. Reservation lifecycle. Emit: booking_created, booking_confirmed, booking_cancelled. |
| 4 | **messaging-service** | messaging | Skeleton. Conversations, messages, read receipts. |
| 5 | **notification-service** | — | Skeleton. Kafka consumer only; stateless. |
| 6 | **trust-service** | trust | Skeleton. Reviews, ratings, moderation, listing_flagged, user_suspended. |
| 7 | **analytics-service** | — | Skeleton. Kafka consumer only; never in request path. |

**Also in bundle:** `services/common`, `services/api-gateway`, `services/cron-jobs`, `webapp/` (root). **Root:** package.json, pnpm-workspace.yaml, tsconfig.base.json. **CI/Docker:** Each service must have multi-stage Dockerfile (build common first), /health, /metrics, pnpm install --frozen-lockfile, production-only final stage, non-root user. **Layout:** Add `infra/k8s/base/<service>/` deploy for each service; register in base kustomization; point Caddy/Envoy at your API gateway and backends. Use **7 DBs** (auth, listings, bookings, messaging, trust; notification and analytics are stateless consumers) in Docker Compose and in `BACKUP_DBS` / `INSPECT_DBS` with your own ports and schema names.

---

## 5. MetalLB and run-preflight

- **MetalLB:** Included in the bundle (`infra/k8s/metallb/`, `scripts/install-metallb.sh`, `scripts/setup-new-colima-cluster.sh`). Always set **METALLB_POOL** per project.  
- **run-preflight-scale-and-all-suites.sh:** Included; it drives MetalLB install (when enabled), Caddy deploy, TLS verify, and all suites. Override `NS`, `HOST`, and (if needed) namespace/hostname inside the script for your project.

This keeps the tarball one coherent substrate: MetalLB, k3s, Kafka (strict TLS + **ssl.client.auth=required**), Redis, TLS CA, Ingress (Caddy), gRPC (all protos), services/common + api-gateway reference, protocol verification (HTTP/2, HTTP/3, strict TLS, mTLS), xk6 HTTP/3 and run-k6-phases, metrics-ready layout, DB backup/inspect scripts, and k6/rotation. **Housing-platform:** Follow docs/ARCHITECTURE.md (7 domain services, event-driven, no cross-service DB), use docs/CURSOR_SCAFFOLD_INSTRUCTIONS.md to scaffold, plug in the 6 skeletons + auth ported per §4, then run preflight and k6.
