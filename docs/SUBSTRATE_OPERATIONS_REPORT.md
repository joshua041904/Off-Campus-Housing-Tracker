# Substrate Operations Report

**Purpose:** Single authoritative report of how the **substrate** (Colima k3s, Caddy, Envoy, MetalLB, strict TLS, mTLS) is operated. All paths are relative to the repository root. This document is **portable**: another project can adopt the same substrate by copying the referenced files and following the procedures.

**Last updated:** 2026-03 (Colima k3s primary, MetalLB L2, rotation H3 warmup, Caddy request logging).

---

## 0. Bundle output path and root docs

**Create bundle at a fixed path (e.g. `/Users/tom/Off-Campus-Housing-Tracker`):**

```bash
BUNDLE_OUTPUT_ROOT=/Users/tom BUNDLE_FOLDER_NAME=Off-Campus-Housing-Tracker ./scripts/build-substrate-bundle.sh
```

- **BUNDLE_OUTPUT_ROOT** — Parent directory for the bundle folder (e.g. `/Users/tom`).
- **BUNDLE_FOLDER_NAME** — Name of the bundle folder (e.g. `Off-Campus-Housing-Tracker`).
- Bundle is created at `$BUNDLE_OUTPUT_ROOT/$BUNDLE_FOLDER_NAME`. Tarball is written as `$BUNDLE_OUTPUT_ROOT/$BUNDLE_FOLDER_NAME.tar.gz`.

**Root docs in the bundle:**

| File | Content |
|------|--------|
| **README.md** | Housing-specific project README (ported from RP with changes): project overview, user cases, architecture, clear breakdown of what each service does. No RP-specific breakthroughs. |
| **ENGINEERING.md** | Same as RP engineering doc with a **cluster-only focus** note at the top: Kubernetes, Caddy, Envoy, MetalLB, TLS, deployment. |
| **Runbook.md** | Same as RP runbook with a **cluster-only focus** note at the top: cluster stabilization, runbook issues and fixes. |

README is sourced from **docs/housing-platform/README.md** when building the bundle; ENGINEERING.md and Runbook.md are copied from the repo root with the cluster-only note prepended.

---

## 1. Housing-platform alignment (global-scale ready)

The substrate bundle produced by `scripts/build-substrate-bundle.sh` is aligned with a **housing-platform global-scale spec**:

- **7 domain services:** auth-service (ported), listings-service, booking-service, messaging-service, notification-service, trust-service, analytics-service. Event-driven; cross-domain only via Kafka. No cross-service DB access.
- **Root layout:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `docker-compose.yml` (Postgres + Kafka + Redis), `services/`, `webapp/`, `proto/`, `infra/k8s/base` and `overlays/`, `scripts/`, `docs/`.
- **Infra set in stone:** Caddy, Envoy, MetalLB, strict TLS, Kafka mTLS required. Each service: own DB/Prisma, /health, /metrics, multi-stage Dockerfile (build common first), non-root user, CI-ready.
- **Spec docs in bundle:** When building with the housing spec, the bundle includes **docs/ARCHITECTURE.md** (full architecture and service boundaries) and **docs/CURSOR_SCAFFOLD_INSTRUCTIONS.md** (Cursor instruction block to scaffold workspace, Dockerfiles, and CI). Use them in the new repo to scaffold from the spec without over-coupling.
- **Kafka in tarball:** Strict TLS (SSL only on 9093), mTLS required (`KAFKA_SSL_CLIENT_AUTH=required`), and exactly-once semantics (idempotent producer, read_committed consumer). Bundle includes **kafka-external** (Service+Endpoints to external broker), **kafka** (in-cluster optional), **scripts/kafka-ssl-from-dev-root.sh**, and **docs/KAFKA_SUBSTRATE.md**. After apply, patch kafka-external Endpoints IP to host.
- **infra copied (excl. db, ansible):** Bundle copies **infra/docs**, **infra/haproxy**, **infra/kafka**, **infra/nginx**, **infra/k8s** from RP. **infra/db** and **infra/ansible** are not included.
- **K8s base = substrate only:** **infra/k8s/base/** contains only substrate (namespaces, config, kafka-external, kafka, envoy-test, redis, haproxy, nginx, observability, monitoring, exporters). **No** RP app services; you add `base/<service>/` per app and register in **base/kustomization.yaml**. **overlays/dev** includes HPA example (hpa-api-gateway.yaml). Replace `off-campus-housing-tracker` namespace in all manifests.
- **REPO_SETUP_SPEC.md:** In-depth spec (objective, root structure, service responsibilities, event-driven, DB policy, CI, Docker, security, scaling, phase 1 order, Cursor instruction block) is in the bundle as **docs/REPO_SETUP_SPEC.md**.

See **docs/SUBSTRATE_BUNDLE_OPERATIONS.md** for what the tarball contains and how to add the 7 services.

---

## 2. Substrate definition

The substrate is the shared infrastructure layer that provides:

| Component | Role |
|-----------|------|
| **Colima + k3s** | Local Kubernetes (single-node or multi-node). API at `127.0.0.1:6443`. Alternative: k3d with `REQUIRE_COLIMA=0`. |
| **MetalLB** | L2 LoadBalancer so `type: LoadBalancer` gets an external IP (e.g. `192.168.64.240`). Required for HTTP/3 from host when not using NodePort. |
| **Caddy** | Edge TLS termination, HTTP/1.1, HTTP/2, HTTP/3 (QUIC). Hostname `off-campus-housing.local`. Serves REST, web, and proxies gRPC to Envoy. |
| **Envoy** | gRPC proxy (port 10000). Receives gRPC from Caddy (h2c). Uses **mTLS** to backends (auth, records, listings, etc.). |
| **Strict TLS** | TLS 1.2/1.3 only; dev-root CA (`certs/dev-root.pem`); leaf cert for `off-campus-housing.local`. No weak ciphers. |
| **mTLS** | Backend services present server certs; Envoy presents a **client cert** (CN=envoy) to backends. CA = same dev-root. |
| **Data plane (external)** | **Docker Compose**: Redis (6379) and Kafka (Zookeeper + broker SSL 9093 / host 29093) are **substrate** — same across projects. **Postgres/DBs are per-project** (e.g. off-campus-housing-tracker 8 DBs, housing 10); schemas and ports differ. Pods reach them via `host.docker.internal` (Colima) or `192.168.5.2` (k3d). |
| **Kafka** | Strict TLS on 9093; optional **ssl.client.auth=required** (mTLS) for projects that require client authentication. Single broker by default; **multi-broker (e.g. 2)** possible without breaking Colima k3s if kept small. |
| **Redis** | Single instance in Docker; no password in dev. Apps use `REDIS_URL` (e.g. `redis://host.docker.internal:6379/0`). Same across projects. |
| **MirrorMaker 2** | When replicating between clusters: exactly-once, strict TLS, mTLS. Substrate supports adding MirrorMaker 2 with same CA/certs. |
| **Metrics** | Prometheus/exporters in `monitoring` namespace; optional observability stack (Grafana, Jaeger, Otel) in `observability`. Substrate-ready; scrape targets and dashboards are per-project. |

### 1.1 Substrate components checklist (must be present)

| Component | Purpose |
|-----------|--------|
| **MetalLB** | L2 LoadBalancer for `type: LoadBalancer` (e.g. Caddy). Per-project IP pool. |
| **k3s** | Kubernetes API and workload (Colima or k3d). |
| **Kafka** | Message bus (Docker or in-cluster). Strict TLS 9093; optional mTLS. |
| **Redis** | Cache/session store (Docker). Same across projects. |
| **TLS CA** | dev-root CA + leaf cert for ingress hostname; Envoy client cert for mTLS. |
| **Ingress** | Caddy: TLS termination, HTTP/2, HTTP/3, gRPC proxy to Envoy. |
| **Metrics** | Prometheus/exporters (and optionally Grafana/Jaeger). |

### 1.2 Tuning reference (plug-in ready)

Substrate is ready to plug in with the following tuning knobs documented and applied where applicable:

- **Kafka:** `num.partitions`, `replication.factor`, `min.insync.replicas` — see §2.6 and §2.6a.
- **Redis:** `maxmemory`, `maxmemory-policy`, Lua scripts — see §2.5a.
- **K8s:** HPA rules, resource limits/requests, pod anti-affinity — see §2.7.

Traffic flow:

- **Client → Caddy** (HTTPS, SNI `off-campus-housing.local`) → REST/Web → API Gateway, or gRPC → **Envoy** (h2c).
- **Caddy → Envoy** (HTTP/2 cleartext inside cluster).
- **Envoy → backends** (gRPC over TLS with client cert).

---

## 3. Key files (portable index)

Paths are relative to repo root. Another project can copy this layout and adapt names/ports.

### 2.1 Edge and TLS

| Path | Purpose |
|------|---------|
| `Caddyfile` | Caddy config: vhost `off-campus-housing.local`, TLS paths, routes (REST, gRPC proxy, health, resell, catch-all). Grace period and request access log. |
| `infra/k8s/caddy-h3-deploy.yaml` | Caddy deployment (NodePort; hostPort 443 on single node). |
| `infra/k8s/caddy-h3-deploy-loadbalancer.yaml` | Caddy deployment **without** hostPort (for MetalLB; use with LoadBalancer service). |
| `infra/k8s/caddy-h3-service-loadbalancer.yaml` | LoadBalancer service for Caddy (TCP+UDP 443, admin 2019, gRPC 5000). |
| `infra/k8s/base/envoy-test/deploy.yaml` | Envoy gRPC proxy deployment; mounts `dev-root-ca`, `envoy-client-tls`. |
| `infra/k8s/base/config/proto/health.proto` | gRPC health proto (used by Envoy and services). |
| `scripts/strict-tls-bootstrap.sh` | Create/update TLS secrets: `record-local-tls`, `dev-root-ca`, `service-tls`, `envoy-client-tls` in the right namespaces. |
| `scripts/rollout-caddy.sh` | Deploy Caddy (NodePort or LoadBalancer per `CADDY_USE_LOADBALANCER`). |
| `scripts/generate-envoy-client-cert.sh` | Generate Envoy client cert (CN=envoy) from dev-root CA. |

### 2.2 Certificates and rotation

| Path | Purpose |
|------|---------|
| `certs/dev-root.pem` | Canonical CA cert (synced from cluster or reissue). Used by k6, curl, and ConfigMaps. |
| `certs/dev-root.key` | CA key (persisted only when reissuing; not in cluster). |
| `certs/off-campus-housing.local.crt`, `certs/off-campus-housing.local.key` | Leaf cert for `off-campus-housing.local`. |
| `certs/envoy-client.crt`, `certs/envoy-client.key` | Envoy client cert for mTLS to backends. |
| `scripts/reissue-ca-and-leaf-load-all-services.sh` | Reissue CA + leaf; update secrets; optional Kafka SSL. |
| `scripts/rotation-suite.sh` | Full rotation runbook: reissue, Caddy reload, backend restarts, grace, H3 warmup, k6 chaos. |
| `scripts/test-full-chain-with-rotation.sh` | Test TLS chain and rotation (smoke). |

### 2.3 Namespaces (substrate creates these)

All namespaces the substrate expects; create them so Kustomize and scripts apply cleanly.

| Namespace | Purpose |
|-----------|---------|
| `off-campus-housing-tracker` | App deployments, API Gateway, services, HAProxy, config, Kafka external Service/Endpoints. |
| `ingress-nginx` | Caddy (caddy-h3) deployment and LoadBalancer service. |
| `envoy-test` | Envoy gRPC proxy (created by `strict-tls-bootstrap.sh` or rollout if missing). |
| `monitoring` | Prometheus/exporters (if used). |
| `observability` | Grafana, Jaeger, Otel (if used; has its own `namespace.yaml` in base/observability). |
| `k6-load` | Created by rotation/run-k6-chaos when running k6 Jobs; not in base kustomization. |

**File:** `infra/k8s/base/namespaces.yaml` defines `off-campus-housing-tracker`, `monitoring`, `ingress-nginx`. Envoy and k6-load are created by scripts. Observability namespace is in `infra/k8s/base/observability/namespace.yaml`.

### 2.4 MetalLB

| Path | Purpose |
|------|---------|
| `infra/k8s/metallb/` | MetalLB manifests (if any in repo). |
| `infra/docs/METALLB.md` | MetalLB install and pool (e.g. Colima `192.168.64.240/28`). |
| `scripts/install-metallb.sh` | Install MetalLB and apply pool/L2 (waits for webhook). |
| `scripts/verify-metallb-and-traffic-policy.sh` | Verify LB IP, in-cluster curl, HTTP/1.1, HTTP/2, HTTP/3. |

**Important:** The **MetalLB IP pool is per-project**. You cannot use the same LB IP range for two clusters on the same network (e.g. off-campus-housing-tracker and housing). Use a different range per project (e.g. off-campus-housing-tracker `192.168.64.240-192.168.64.250`, housing `192.168.64.251-192.168.64.260` or a different subnet). Set `METALLB_POOL` when installing or apply a project-specific pool manifest.

### 2.5 Data plane (Docker: Redis, Kafka, DBs)

| Path | Purpose |
|------|---------|
| `docker-compose.yml` | Defines Zookeeper, Kafka (SSL 9093, host 29093), **Redis** (6379), and **Postgres** instances. **Redis and Kafka are substrate** (same pattern across projects). **Postgres/DB count and schemas are per-project** (off-campus-housing-tracker: 8 DBs on 5433–5440; housing or others: e.g. 10 DBs with different ports/schemas). |
| `infra/k8s/base/config/app-config.yaml` | `REDIS_URL`, `KAFKA_BROKER`, `KAFKA_USE_SSL`, `KAFKA_SSL_ENABLED`, and per-service `POSTGRES_URL_*`. Adapt DB URLs and count per project; keep Redis and Kafka config pattern. |
| `scripts/kafka-ssl-from-dev-root.sh` | Build Kafka broker keystore/truststore from dev-root CA; create `kafka-ssl-secret` for broker and clients. Run after reissue. |
| `certs/kafka-ssl/` | Broker JKS and CA PEM (output of kafka-ssl-from-dev-root.sh); mounted by Docker Compose Kafka and by pods that use Kafka. |

### 2.5a Redis tuning (substrate-ready)

| Knob | Where | Purpose |
|------|--------|---------|
| **maxmemory** | `docker-compose.yml` (Redis command) or `infra/k8s/base/redis/config/redis.conf` | Cap memory (e.g. 512mb in Docker, 1gb in-cluster). |
| **maxmemory-policy** | Same | Eviction policy: `allkeys-lfu` (recommended for cache), or `volatile-lru`, `noeviction`, etc. |
| **lfu-decay-time** / **lfu-log-factor** | redis.conf | Tune LFU eviction quality. |
| **Lua scripts** | App-specific | Substrate does not ship Lua; if your app uses `EVAL`/`SCRIPT LOAD`, add scripts and call from app. Document path and usage in your project. |

**Current off-campus-housing-tracker:** Docker Redis uses `--maxmemory 512mb`, `--maxmemory-policy allkeys-lfu`, `--lfu-decay-time 1`. In-cluster Redis (if used) uses `infra/k8s/base/redis/config/redis.conf` (maxmemory 1gb, allkeys-lfu).

### 2.6 Kafka: strict TLS, mTLS (ssl.client.auth=required), MirrorMaker

- **Strict TLS:** Broker listens on SSL only for clients (e.g. `0.0.0.0:9093`); PLAINTEXT only on localhost for healthcheck. All app clients use `KAFKA_SSL_ENABLED=true`, `KAFKA_CA_CERT`, and port 9093.
- **mTLS (client auth required):** For projects (e.g. housing) that require **ssl.client.auth=required**, set on the broker (e.g. Confluent: `KAFKA_SSL_CLIENT_AUTH=required`). Clients must present a client cert; generate client keystores and set `KAFKA_CLIENT_CERT` / `KAFKA_CLIENT_KEY` in app deployments. Same dev-root CA can sign broker and client certs.
- **Multi-broker:** Up to **2 brokers** is safe on Colima k3s without overloading the control plane. Add a second broker in Docker Compose or as a second service; use the same SSL and (if required) client auth config.
- **MirrorMaker 2:** For replication between clusters (e.g. dev → staging), run MirrorMaker 2 with **strict TLS and mTLS** (same CA, client certs for both source and target). Configure exactly-once semantics where supported. Document source/target bootstrap servers, topic patterns, and replication flows. See `docs/KAFKA_CURRENT_AND_ROADMAP.md` and add MirrorMaker manifests or docs to the substrate bundle.

| Path | Purpose |
|------|---------|
| `docs/STRICT_TLS_MTLS_AND_KAFKA.md` | Checklist: no cleartext, Kafka SSL, client certs. |
| `docs/KAFKA_CURRENT_AND_ROADMAP.md` | Current single-broker setup, multi-broker, exactly-once, MirrorMaker 2. |
| `docker-compose.yml` | Kafka env: optional **KAFKA_SSL_CLIENT_AUTH: required** (commented by default). Uncomment for mTLS; then supply client certs to apps. |

**MirrorMaker 2 (substrate):** Replication between clusters uses the same CA and strict TLS/mTLS. Configure MirrorMaker 2 with exactly-once semantics, source/target bootstrap servers (SSL, port 9093), and client certs when `ssl.client.auth=required`. See `docs/KAFKA_CURRENT_AND_ROADMAP.md`; add MirrorMaker 2 manifests or runbooks to the bundle when they exist in the repo.

### 2.6a Kafka tuning (num.partitions, replication.factor, min.insync.replicas)

| Knob | Where | Purpose |
|------|--------|---------|
| **num.partitions** | Per-topic (kafka-topics or broker `num.partitions`) | Default partition count for new topics; tune per topic for parallelism and ordering. |
| **replication.factor** | Broker default or per-topic | `KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1` for single broker; set to 2–3 for multi-broker. Use `default.replication.factor` for new topics. |
| **min.insync.replicas** | Broker config | Require at least N in-sync replicas for acks; trade availability vs durability (e.g. 2 with replication.factor 3). |

**Current off-campus-housing-tracker:** Single broker in Docker; `KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1`. For multi-broker (e.g. 2): set `default.replication.factor=2`, `min.insync.replicas=1` (or 2 for stronger durability). See `docs/KAFKA_CURRENT_AND_ROADMAP.md` (replication tuning, ISR tuning).

### 2.7 HPA and deployment manifests (K8s tuning)

| Tuning | Where | Purpose |
|--------|--------|---------|
| **HPA rules** | `infra/k8s/overlays/dev/hpa-api-gateway.yaml` | HorizontalPodAutoscaler: CPU 70% target, min 1 / max 10 replicas, scale-up 15s / scale-down 600s stabilization. Copy pattern for other services; change `scaleTargetRef` to your deployment name and namespace. |
| **Resource limits** | `infra/k8s/base/*/deploy.yaml` and `infra/k8s/caddy-h3-deploy-loadbalancer.yaml` | Each deploy sets `resources.requests` and `resources.limits` (e.g. Caddy: 1000m/512Mi requests, 2000m/1Gi limits). Adjust per service; substrate ships with sane defaults. |
| **Pod anti-affinity** | `infra/k8s/caddy-h3-deploy.yaml` (required) and `caddy-h3-deploy-loadbalancer.yaml` (preferred) | Spread Caddy replicas across nodes: **preferred** (soft) allows 2 on 1 node for Colima single-node; **required** (hard) needs 2 nodes for 2 replicas. Use same pattern for critical ingress/gateway. |

| Path | Purpose |
|------|---------|
| `infra/k8s/overlays/dev/hpa-api-gateway.yaml` | HPA example: API Gateway (CPU 70%, min 1, max 10). Replace namespace and deployment name for your project. |
| `infra/k8s/base/*/deploy.yaml` | All service deployments (auth, api-gateway, records, listings, social, shopping, analytics, auction-monitor, python-ai, envoy-test, haproxy, nginx). **Porting:** change image names and env; keep resources and structure. |
| `infra/k8s/caddy-h3-deploy-loadbalancer.yaml` | Caddy with soft anti-affinity and resource limits; use with MetalLB. |

### 2.8 Colima and cluster

| Path | Purpose |
|------|---------|
| `scripts/colima-start-and-ready.sh` | Start Colima VM and wait for k3s API. |
| `scripts/colima-apply-host-aliases.sh` | Patch app deployments so `host.docker.internal` resolves to the host IP (required for pods to reach Postgres/Redis/Kafka on host). |
| `scripts/ensure-k8s-api.sh` | Ensure Kubernetes API is reachable (Colima or k3d). |
| `scripts/ensure-ready-for-preflight.sh` | Full readiness: diagnostic, curl HTTP/3, API, DBs, Kafka; optional Colima host aliases; then run preflight. |
| `scripts/get-pods-to-ready.sh` | Colima host aliases + shopping order_number sequence + rollout wait (fixes 0/1 Ready). |

### 2.9 Kustomize and app base

| Path | Purpose |
|------|---------|
| `infra/k8s/base/kustomization.yaml` | Base resources: config, secrets, redis, kafka-external, haproxy, nginx, api-gateway, all services, envoy-test. |
| `infra/k8s/overlays/dev/kustomization.yaml` | Dev overlay (patches, images). |
| `infra/k8s/base/config/app-config.yaml` | Shared app config (DB hosts, ports, feature flags). |
| `infra/k8s/base/config/proto/` | Proto files for gRPC. |

### 2.10 Preflight and test suites (portable)

| Path | Purpose |
|------|---------|
| `scripts/run-preflight-scale-and-all-suites.sh` | Top-level preflight: ensure-ready, reissue, scale, 9 suites (auth, baseline, enhanced, adversarial, rotation, standalone-capture, tls-mtls, social, lb-coordinated). **Porting:** script uses `off-campus-housing-tracker` namespace and Colima/k3d context; override with env or search-replace `off-campus-housing-tracker` / hostname per project. |
| `scripts/ensure-ready-for-preflight.sh` | Layered readiness before preflight (API, DBs, Kafka, optional host aliases). |
| `scripts/test-microservices-http2-http3.sh` | Baseline: HTTP/2 + HTTP/3 + gRPC health, strict TLS. Uses `HOST`, `NS` (default off-campus-housing.local, off-campus-housing-tracker). |
| `scripts/test-tls-mtls-comprehensive.sh` | TLS/mTLS tests (chain, gRPC, Envoy, client cert). |
| `scripts/rotation-suite.sh` | CA/leaf rotation, Caddy reload, H3 warmup, k6 chaos. |
| `scripts/test-packet-capture-standalone.sh` | Packet capture (Caddy/Envoy tcpdump), HTTP/2 + HTTP/3 + gRPC traffic. |
| `scripts/test-lb-coordinated.sh` | Caddy in-cluster health, HAProxy, MetalLB verification. |
| `scripts/compare-h2-h3-headers.sh` | Compare HTTP/2 vs HTTP/3 request headers (for routing debug). |
| `scripts/setup-new-colima-cluster.sh` | One-shot Colima + k3s + MetalLB. **METALLB_POOL** (default 192.168.64.240–250); set a different range per project (e.g. housing .251–260). See `docs/NEW_CLUSTER_SETUP.md`. |
| `scripts/backup-all-dbs.sh` | Backup N external Postgres DBs; **PGPASSWORD=postgres** in script; writes dumps and `backup-report-<timestamp>.md`. Override **BACKUP_DBS** (format `port:dbname:label`) for your DB layout. |
| `scripts/inspect-external-db-schemas.sh` | Inspect external DBs; **PGPASSWORD=postgres**; writes `schema-report-<timestamp>.md`. Override **INSPECT_DBS** for your DB list. |
| **scripts/lib/** | Shared networking and test helpers. **scripts/lib/http3.sh** is used by baseline/rotation for HTTP/3 curl and `--resolve`; uses `HTTP3_EXPECTED_HOST` (default off-campus-housing.local). **scripts/lib/kubectl-helper.sh** used by run-preflight. Bring entire `scripts/lib/` when porting; override host/namespace via env where supported. |
| **scripts/load/** | k6 scripts (e.g. k6-chaos-test.js, k6-http3-complete.js, k6-reads.js) included in bundle; add your own k6 tests here. |

### 2.11 Documentation (this substrate)

| Path | Purpose |
|------|---------|
| `docs/SUBSTRATE_OPERATIONS_REPORT.md` | **This file.** Portable substrate operations. |
| `docs/SUBSTRATE_BUNDLE_OPERATIONS.md` | What’s in the tarball, what’s RP-specific (left out), how to operate, what to add (e.g. housing 10 services). |
| `docs/ARCHITECTURE_SETUP_AND_USER_STORY.md` | High-level setup, user case, user story. |
| `ENGINEERING.md` | Deep technical architecture. |
| `Runbook.md` | Bugs, issues, solutions index. |
| `scripts/TEST-FAILURES-AND-WARNINGS.md` | Test failure explanations and fixes. |
| `scripts/RUN-PREFLIGHT.md` | How to run preflight. |
| `scripts/ROTATION-SUITE-DEPENDENCIES.md` | Rotation suite dependencies. |

---

## 4. Operational procedures

### 3.1 Bring-up (first time or after teardown)

1. **Start cluster**
   - Colima: `./scripts/colima-start-and-ready.sh` (or `colima start` then wait for API).
   - k3d: create/start cluster; merge kubeconfig.

2. **External data plane**
   - Start Docker Compose (Postgres 5433–5440, Redis 6379, Kafka 9092/9093).

3. **MetalLB** (if using LoadBalancer for Caddy)
   - `./scripts/install-metallb.sh` (or apply MetalLB manifests + pool/L2).
   - Ensure pool range matches Colima VM network (e.g. `192.168.64.240-192.168.64.250`).

4. **Certificates and TLS**
   - Generate or copy CA + leaf: e.g. `KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh`.
   - `./scripts/generate-envoy-client-cert.sh`.
   - `./scripts/strict-tls-bootstrap.sh` (creates secrets in ingress-nginx, off-campus-housing-tracker, envoy-test).

5. **Caddy**
   - With MetalLB: `CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh` and apply `infra/k8s/caddy-h3-service-loadbalancer.yaml`.
   - Without MetalLB: `./scripts/rollout-caddy.sh` (NodePort).

6. **Apply Kustomize**
   - From repo root: `kubectl apply -k infra/k8s/overlays/dev` (or base + your overlay).

7. **Colima: host aliases** (so pods reach Postgres/Redis/Kafka)
   - `./scripts/colima-apply-host-aliases.sh` (or run as part of `ensure-ready-for-preflight.sh`).

8. **Optional: shopping order_number**
   - `./scripts/ensure-shopping-order-number-sequence.sh` (applies migration for atomic order numbers).

### 3.2 Preflight (full verification)

- `./scripts/ensure-ready-for-preflight.sh` then:
  - `METALLB_ENABLED=1 ./scripts/run-preflight-scale-and-all-suites.sh` (Colima + MetalLB).
- Or with auto-run: `./scripts/ensure-ready-for-preflight.sh --run`.

Preflight runs: auth, baseline HTTP/2+HTTP/3, enhanced, adversarial, **rotation** (reissue + chaos), standalone packet capture, TLS/mTLS, social comprehensive, lb-coordinated.

### 3.3 Rotation (CA + leaf, zero-downtime under load)

1. Reissue CA and leaf (or use existing certs).
2. Update secrets in cluster (`record-local-tls`, `dev-root-ca`, `service-tls`; Envoy `envoy-client-tls` if CA changed).
3. Caddy reload: admin API `POST /load` (or rolling restart if hot reload not available).
4. Restart all gRPC/TLS backends so they load new certs.
5. **Grace**: `ROTATION_GRACE_SECONDS=8` (default) after Caddy/Envoy ready.
6. **Pre-warm**: `ROTATION_PREWARM_SLEEP` (default 15s).
7. **H3 warmup**: `ROTATION_H3_WARMUP=5` (default): 5× HTTP/3 health to clear stale QUIC sessions before k6.
8. Run k6 chaos with `K6_HTTP3_NO_REUSE=1` (no QUIC reuse; set in rotation-suite.sh and passed to Job).

All of the above are implemented in `scripts/rotation-suite.sh`. Run: `./scripts/rotation-suite.sh`.

### 3.4 Host → Caddy (HTTP/3) when using MetalLB on Colima

- MetalLB assigns an IP on the **VM** network (e.g. 192.168.64.240). The Mac host may not be on that subnet.
- One-time route on Mac (if needed): `sudo route add -host 192.168.64.240 <colima-vm-ip>` (or use Colima’s bridged networking if available).
- Verify script writes `REACHABLE_LB_IP` for suites; curl/health use `--resolve off-campus-housing.local:443:<LB_IP>` and `certs/dev-root.pem`.

### 3.5 Pods 0/1 Ready (Colima)

- Cause: pods cannot reach Postgres/Redis/Kafka; often `host.docker.internal` is wrong.
- Fix: `./scripts/colima-apply-host-aliases.sh` then wait for rollouts, or run `./scripts/get-pods-to-ready.sh`.

---

## 5. Configuration reference

### 4.1 Kubernetes secrets (substrate)

| Secret | Namespace(s) | Contents | Used by |
|--------|--------------|----------|---------|
| `record-local-tls` | ingress-nginx, off-campus-housing-tracker | tls.crt, tls.key (leaf) | Caddy, optional nginx |
| `dev-root-ca` | ingress-nginx, off-campus-housing-tracker, envoy-test, k6-load | dev-root.pem | Caddy (optional), services (trust), Envoy (trust), k6 ConfigMap |
| `service-tls` | off-campus-housing-tracker | tls.crt, tls.key, ca.crt | Backend services (server + client TLS) |
| `envoy-client-tls` | envoy-test | envoy.crt, envoy.key | Envoy (client cert to backends) |

### 4.2 Important environment variables

| Variable | Typical value | Used by |
|----------|----------------|---------|
| `METALLB_ENABLED` | 1 | Preflight/run-all (use LB IP for Caddy). |
| `REQUIRE_COLIMA` | 0 or 1 | Whether Colima is required (0 = k3d OK). |
| `TARGET_IP` / `REACHABLE_LB_IP` | 192.168.64.240 | LB IP for curl/k6 (set by verify or metallb-reachable.env). |
| `K6_HTTP3_NO_REUSE` | 1 | k6 chaos (no QUIC reuse; rotation). |
| `ROTATION_GRACE_SECONDS` | 8 | Seconds after Caddy/Envoy ready before load. |
| `ROTATION_H3_WARMUP` | 5 | Number of HTTP/3 health requests before chaos; 0 = skip. |
| `ROTATION_PREWARM_SLEEP` | 15 | Seconds settle before chaos. |
| `HOST` | off-campus-housing.local | TLS SNI and Host header for tests. |

### 4.3 Caddyfile conventions (portable)

- **Single primary vhost**: `https://off-campus-housing.local` (or your hostname). TLS paths: `/etc/caddy/certs/tls.crt`, `tls.key`.
- **Health**: `handle_path /_caddy/healthz { respond "ok" 200 }` (no redirect).
- **gRPC**: Route by path or `path_regexp \.` to Envoy; `transport http { versions h2c }`.
- **REST**: Reverse proxy to API Gateway; use `handle` (not `handle_path`) for `/api/*` so path is not stripped and H2/H3 behave the same.
- **Graceful shutdown**: `grace_period 15s`, `shutdown_delay 10s` for QUIC/TLS drain during rotation.
- **Request logging**: `log request_access { output stdout format json }`; optional `log_append <request_host` / `request_uri` / `request_proto` in specific handles for debug.

---

## 6. How HTTP/2, HTTP/3, and gRPC work (substrate behavior)

- **Caddy** listens on port **443** (TLS). It terminates TLS and speaks HTTP/1.1, HTTP/2, and HTTP/3 (QUIC) on the same port. ALPN selects the protocol (e.g. `h2` for HTTP/2, `h3` for HTTP/3). Clients must use **SNI** = your hostname (e.g. `off-campus-housing.local`) and present the CA so the leaf cert is trusted.
- **HTTP/2:** TLS 1.2/1.3 with ALPN `h2`. Requests over a single connection are multiplexed. Health and REST go through Caddy to the API Gateway or backends. Use `--http2` with curl and `--resolve <host>:443:<LB_IP>` when targeting the MetalLB IP.
- **HTTP/3 (QUIC):** UDP 443. Same TLS cert as HTTP/2. Use `--http3` (or `--http3-only`) with curl; same `--resolve` and CA. On Colima, the host may not have UDP 443 to the VM; in-cluster pods (hostNetwork) can verify QUIC to the LB IP. Rotation and load tests use **no QUIC connection reuse** (`K6_HTTP3_NO_REUSE=1`) after cert reload to avoid stale-session timeouts.
- **gRPC:** Caddy matches gRPC-style paths (e.g. by path or `path_regexp \.`) and proxies to **Envoy** over **h2c** (HTTP/2 cleartext). Envoy then forwards to backend services over **TLS with mTLS** (Envoy presents client cert). So: Client → Caddy (TLS) → Envoy (h2c) → Backend (TLS + client cert). All use the same dev-root CA.

---

## 7. Portable adoption checklist (another project)

To reuse this substrate in a new project (e.g. housing):

1. **Copy or symlink**
   - `Caddyfile` (adapt hostname and routes).
   - `scripts/strict-tls-bootstrap.sh`, `scripts/rollout-caddy.sh`, `scripts/generate-envoy-client-cert.sh`.
   - `scripts/reissue-ca-and-leaf-load-all-services.sh` (or your cert pipeline).
   - `scripts/rotation-suite.sh`, `scripts/run-k6-chaos.sh`, `scripts/k6-chaos-test.js` (if you want rotation chaos).
   - `infra/k8s/caddy-h3-deploy-loadbalancer.yaml`, `infra/k8s/caddy-h3-service-loadbalancer.yaml` (if using MetalLB).
   - `infra/k8s/base/envoy-test/` (Envoy deploy + config).
   - `infra/k8s/base/config/` (app-config, proto).
   - `infra/k8s/base/namespaces.yaml` (and observability namespace if used).
   - `infra/k8s/overlays/dev/hpa-api-gateway.yaml` (and add HPAs for other services as needed).
   - MetalLB manifests or `scripts/install-metallb.sh`.
   - Colima/k3s scripts: `colima-apply-host-aliases.sh`, `ensure-ready-for-preflight.sh`, `ensure-k8s-api.sh`.
   - Preflight and networking: `scripts/run-preflight-scale-and-all-suites.sh`, `scripts/lib/` (whole directory: http3.sh, kubectl-helper.sh, etc.).
   - Data plane: `docker-compose.yml` (Kafka + Redis + your DBs), `scripts/kafka-ssl-from-dev-root.sh`, `docs/STRICT_TLS_MTLS_AND_KAFKA.md`, `docs/KAFKA_CURRENT_AND_ROADMAP.md`.

2. **Adapt**
   - Replace `off-campus-housing.local` with your hostname in Caddyfile, scripts, and certs.
   - Replace `off-campus-housing-tracker` namespace with your app namespace where relevant.
   - **DBs:** Use your own Postgres count and schemas (e.g. 10 DBs); keep Redis and Kafka the same (Redis URL, Kafka broker + SSL).
   - **MetalLB:** Use a **different IP pool** (e.g. `192.168.64.251-260`) so it does not conflict with another project on the same network.
   - **Kafka:** If you need **ssl.client.auth=required**, set `KAFKA_SSL_CLIENT_AUTH=required` on the broker and supply client certs to apps (`KAFKA_CLIENT_CERT`, `KAFKA_CLIENT_KEY`).
   - **MirrorMaker 2:** Add MirrorMaker 2 config and manifests with strict TLS + mTLS and exactly-once when replicating between clusters.
   - Ensure leaf cert SANs include your hostname and ClusterIP FQDN if needed.

3. **Secrets**
   - Generate CA + leaf (e.g. with same reissue script or step-certificate).
   - Run `strict-tls-bootstrap.sh` after placing certs in `certs/`.
   - Create Envoy client cert and `envoy-client-tls` secret.
   - Kafka: run `kafka-ssl-from-dev-root.sh` so broker and (if mTLS) client certs exist; create `kafka-ssl-secret` in your app namespace.

4. **Namespaces**
   - Ensure all substrate namespaces exist (off-campus-housing-tracker or your name, ingress-nginx, envoy-test, monitoring, observability; k6-load created by scripts when needed).

5. **Verify**
   - Run ensure-ready then preflight (or your equivalent suites).
   - Confirm HTTP/2 and HTTP/3 to health and one REST route; confirm gRPC health via Envoy.
   - Confirm Redis and Kafka connectivity from a pod (host.docker.internal and kafka-external or your Kafka bootstrap).

6. **Document**
   - Keep a copy of this report (or a shortened “Substrate quick reference”) in the new repo and point to it from the main README.

---

### What to change when porting

| Asset | What to change |
|-------|----------------|
| **Caddyfile** | Replace `off-campus-housing.local` with your hostname (vhost and TLS SNI). Replace every `*.off-campus-housing-tracker.svc.cluster.local` with `*.<your-namespace>.svc.cluster.local`. Adjust route paths if your API is under a different prefix (e.g. `/api/` → `/v1/`). Leave grace_period, servers.protocols, transport h2c, and log config as-is. |
| **infra/k8s** | **Namespace:** Replace `off-campus-housing-tracker` in namespaces.yaml, all deploy.yaml metadata.namespace, HPA namespace, and ConfigMap/Secret refs. **Service names:** Deploy and service names (e.g. api-gateway, auth-service) can stay or be renamed; update Caddyfile reverse_proxy targets and Envoy clusters to match. **Images:** Set your registry/image names in overlays. |
| **proto/** | Proto package and service names can stay or be renamed; ensure Caddy/Envoy routes and backend gRPC server names match. Copy `proto/health.proto` (and any shared protos); app-specific protos are per-project. |
| **Scripts** | Most scripts use `NS="${NS:-off-campus-housing-tracker}"` and `HOST="${HOST:-off-campus-housing.local}"`. Export `NS` and `HOST` in the new project (e.g. in a `.env` or wrapper script), or search-replace once. **scripts/lib/http3.sh** uses `HTTP3_EXPECTED_HOST` (default off-campus-housing.local). **run-preflight-scale-and-all-suites.sh** references off-campus-housing-tracker and Caddy/Envoy; set namespace/host via env where supported or patch the script. |

---

## 8. Compiling the substrate for another project

To produce a **single portable bundle** (e.g. a tarball or a directory) that another repo can drop in:

1. **Create a tarball** with the provided script (copies key files into a directory and tars it):

   ```bash
   ./scripts/build-substrate-bundle.sh substrate-bundle
   # Creates substrate-bundle/ and substrate-bundle.tar.gz in repo root
   ```

   The script copies: `Caddyfile`; Docker Compose; Caddy/MetalLB manifests; envoy-test and base config; namespaces and HPA; proto/health.proto; strict-tls-bootstrap, rollout-caddy, Colima/ensure/rotation/k6 scripts; `run-preflight-scale-and-all-suites.sh`, test and smoke scripts; `scripts/lib/` (http3.sh, kubectl-helper.sh, etc.); and `docs/SUBSTRATE_OPERATIONS_REPORT.md`, METALLB, Kafka, RUN-PREFLIGHT.

2. **Or inline into one doc**: run from repo root and append file contents to a single markdown (e.g. for a wiki or Confluence):

   ```bash
   OUT=docs/SUBSTRATE_COMPILED.md
   echo "# Substrate compiled (generated)" > "$OUT"
   for f in Caddyfile scripts/strict-tls-bootstrap.sh scripts/ensure-ready-for-preflight.sh; do
     echo "## \`$f\`" >> "$OUT"; echo '```' >> "$OUT"; cat "$f" >> "$OUT"; echo '```' >> "$OUT"
   done
   ```

3. **Second project**: untar or copy `substrate-bundle/` into the new repo; replace `off-campus-housing.local` and `off-campus-housing-tracker`; generate certs; run procedures in section 3.

---

## 9. Related docs

- **QUIC/HTTP/3**: `docs/QUIC_INVARIANT_CHECKLIST.md`, `docs/HTTP3_DEBUG_PLAYBOOK.md`.
- **MetalLB**: `infra/docs/METALLB.md`, `docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md`.
- **Colima**: `docs/COLIMA-K3S-METALLB-PRIMARY.md`, `docs/COLIMA_K3S_STABILITY_AND_METALLB.md`.
- **Rotation**: `scripts/ROTATION-SUITE-DEPENDENCIES.md`, `scripts/TEST-FAILURES-AND-WARNINGS.md` (stale QUIC, H3 warmup).
- **Preflight**: `scripts/RUN-PREFLIGHT.md`, `scripts/PLATFORM_READY_STATUS.md`.
