# Off-Campus-Housing-Tracker

## Vision

This is a **Kubernetes-native**, event-driven housing platform for off-campus listings, bookings, messaging, and trust. Local development is **Colima + k3s**–driven; the same stack runs in-cluster with Caddy, Envoy, and strict TLS.

The system is:
- Event-driven
- Domain-isolated
- Horizontally scalable
- Strict TLS enforced
- Kafka mTLS enforced
- Fully containerized
- CI-first

No cross-domain database access is allowed.

---

### The Solution

Off-Campus-Housing-Tracker provides:

- **Listing search and discovery**: Search, filtering by price/distance/tags, geolocation, and availability
- **Booking lifecycle**: Reservations, landlord approval, cancellation, and (future) payment status
- **Messaging**: Conversations, messages, read receipts, and attachments between tenants and landlords
- **Notifications**: Booking confirmations, rent reminders, price-drop alerts, and review notifications (Kafka-driven)
- **Trust and safety**: Reviews, ratings, report abuse, moderation, and listing flags
- **Analytics and insights**: Event aggregation, usage metrics, and platform insights (event-driven, never blocks request path)

---

### Technical Journey

This codebase sits at the intersection of off-campus housing needs and a focus on distributed systems and observability. The goal is to understand how real platforms layer ingress controllers, service meshes, CI/CD-friendly manifests, and QUIC edges. Every choice (Caddy at the edge, nginx micro-cache, HAProxy fan-in, the Kustomize base/overlay split, Terraform/Ansible IAC) is framed so you can trace data flow from a listing search or booking UI through the API gateway and services to Postgres and Grafana. The repo is **Kubernetes-driven** (Colima k3s for local dev, k3d supported) and keeps workflows sharp while remaining a place to try new infra ideas.

For detailed technical documentation, system design, and architectural decisions, see [**ENGINEERING.md**](ENGINEERING.md). **Implementing gRPC handlers:** [**docs/GRPC_ONBOARDING.md**](docs/GRPC_ONBOARDING.md); **PR comment templates (tracked):** [`docs/PR_REVIEW_GRPC_HANDLER_PASTE.example.txt`](docs/PR_REVIEW_GRPC_HANDLER_PASTE.example.txt) — optional local copy `docs/PR_REVIEW_GRPC_HANDLER_PASTE.txt` is gitignored for private tweaks.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Client (Browser/Mobile)                            │
│                    HTTP/3 (QUIC) | HTTP/2 | HTTP/1.1 | gRPC                  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                      │
        HTTP/3 + Web + REST                    gRPC Requests
                    │                                      │
                    ▼                                      ▼
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│      Caddy (Edge Proxy)          │      │      Envoy (gRPC Proxy)           │
│  TLS Termination (TLS 1.2/1.3)   │      │  First-Class gRPC Support         │
│  HTTP/2 + HTTP/3 (QUIC)          │      │  HTTP/2 with TLS                  │
│  NodePort: 30443 (TCP/UDP)       │      │  Port: 10000                      │
│                                  │      │  Never routes through HTTP        │
│  - Web App (Next.js)             │      │  Preserves trailers correctly     │
│  - REST API (/api/*)             │      │  Forbids HTTP error pages         │
│  - Static Assets                 │      │  Enforces HEADERS/DATA ordering   │
└──────────────────┬───────────────┘      └──────────────────┬───────────────┘
                   │                                          │
                   └──────────────────┬──────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ingress-nginx (Kubernetes Cluster)                       │
│                    host: off-campus-housing.test                            │
└──────────────────────┬───────────────────────────┬──────────────────────────┘
                       │                           │
        REST /api/*    │                           │  gRPC /service.*
        (HTTP/2/3)     │                           │  (HTTP/2 TLS)
                       ▼                           ▼
        ┌──────────────────────┐      ┌──────────────────────────────┐
        │  Nginx Edge (8080)   │      │    API Gateway (4020)         │
        │  - Static Assets     │      │    - JWT Verification         │
        │  - Micro-cache       │──────▶│    - Rate Limiting           │
        │  - Rate Limiting     │      │    - Identity Injection      │
        └──────────────────────┘      │    - HTTP → gRPC Proxy       │
                       │               └──────────────┬───────────────┘
                       │                              │
                       ▼                              │
        ┌──────────────────────┐                     │
        │   HAProxy (8081)     │                     │
        │   - Keep-alive Pool  │                     │
        │   - Load Balancing   │                     │
        └──────────┬───────────┘                     │
                   │                                 │
                   └──────────────┬──────────────────┘
                                  │
                                  ▼
        ┌─────────────────────────────────────────────────────────────┐
        │              Kubernetes Services (gRPC + HTTP)               │
        │              namespace: off-campus-housing-tracker           │
        ├─────────────────────────────────────────────────────────────┤
        │                                                              │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
        │  │ Auth Service │  │Listings Svc  │  │ Booking Svc  │       │
        │  │   (4011)     │  │   (4012)     │  │   (4013)     │       │
        │  │ gRPC:50061   │  │ gRPC:50062   │  │ gRPC:50063   │       │
        │  │ HTTP:4011    │  │ HTTP:4012    │  │ HTTP:4013    │       │
        │  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘       │
        │         │                 │                 │               │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
        │  │ Messaging    │  │ Notification │  │ Trust Service │     │
        │  │ Svc (4014)   │  │ Svc (4015)   │  │   (4016)     │     │
        │  │ gRPC:50064   │  │ (event-only) │  │ gRPC:50066   │     │
        │  │ HTTP:4014    │  │              │  │ HTTP:4016    │     │
        │  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘     │
        │         │                 │                 │             │
        │  ┌──────────────┐         │                 │             │
        │  │ Analytics    │  ┌──────────────┐         │             │
        │  │ Svc (4017)   │  │ Media Svc    │         │             │
        │  │ gRPC:50067   │  │   (4018)     │         │             │
        │  │ HTTP:4017    │  │ gRPC:50068   │         │             │
        │  └──────────────┘  │ HTTP:4018    │         │             │
        │                   └──────────────┘         │             │
        └───────────────────────────┼─────────────────┼─────────────┘
                                  │
                                  │ gRPC/HTTP
                                  │
        ┌─────────────────────────┴─────────────────────────────────────┐
        │              External Databases (Docker Compose)              │
        │                    (Outside Kubernetes)                       │
        ├───────────────────────────────────────────────────────────────┤
        │  Ports 5441–5448 (Postgres)                                   │
        │                                                               │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
        │  │ Postgres     │  │ Postgres     │  │ Postgres     │       │
        │  │ Auth (5441)  │  │ Listings     │  │ Bookings     │       │
        │  │              │  │   (5442)     │  │   (5443)     │       │
        │  │ - auth       │  │ - listings   │  │ - bookings   │       │
        │  └──────────────┘  └──────────────┘  └──────────────┘       │
        │                                                               │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
        │  │ Postgres     │  │ Postgres     │  │ Postgres     │       │
        │  │ Messaging    │  │ Notification │  │ Trust        │       │
        │  │   (5444)     │  │   (5445)     │  │   (5446)     │       │
        │  │ - messaging  │  │ - notif.     │  │ - trust      │       │
        │  └──────────────┘  └──────────────┘  └──────────────┘       │
        │                                                               │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
        │  │ Postgres     │  │ Postgres     │  │    Redis     │       │
        │  │ Analytics    │  │ Media (5448) │  │   (6380)     │       │
        │  │   (5447)     │  │ - media      │  │ - JWT Cache  │       │
        │  │ - analytics  │  └──────────────┘  │ - Search     │       │
        │  └──────────────┘                    └──────────────┘       │
        │                                                               │
        │  ┌──────────────┐                                            │
        │  │    Kafka     │                                            │
        │  │ PLAINTEXT:   │                                            │
        │  │ 9092 (local) │  SSL:9093 (strict TLS, mTLS)                │
        │  │ - Events     │  - Booking/listings/trust events            │
        │  └──────────────┘                                            │
        └───────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    Observability Stack (Kubernetes)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Prometheus  │  │   Grafana    │  │    Jaeger    │  │OTel Collector│   │
│  │  (Metrics)   │  │(Visualization)│  │  (Tracing)   │  │  (OTLP)       │   │
│  │ - Scrapes    │  │ - Dashboards │  │ - Distributed│  │ - Receives   │   │
│  │   /metrics   │  │ - Alerts     │  │   Traces     │  │   traces/     │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  │   metrics     │   │
│                                                         └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│              Infrastructure as Code (IAC) Layer                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Terraform (cluster, namespace, ConfigMap) │ Ansible (deploy, inventory)    │
│  test-iac-setup.sh, Makefile, dry-run. See ENGINEERING.md and Runbook.       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# High-Level Architecture

Services are domain-based, not feature-based.

We implement 8 core services:

1. auth-service
2. listings-service
3. booking-service
4. messaging-service
5. notification-service
6. trust-service
7. analytics-service
8. media-service

All cross-service communication happens via Kafka events.

---

# Service Responsibilities

## 1. auth-service
Owns:
- User accounts
- Roles (tenant, landlord, admin)
- JWT issuance and validation
- Account state (active, suspended)
- MFA / passkeys

Database: `auth`

No other service touches this database.

---

## 2. listings-service
Owns:
- Listings
- Pricing
- Geolocation
- Availability
- Filtering (price, distance, tags)
- Search indexing
- Image metadata references

Database: `listings`

No booking logic allowed here.

---

## 3. booking-service
Owns:
- Reservation state machine
- Booking lifecycle
- Cancellation
- Landlord approval
- Payment status (future)

Database: `bookings`

Emits events:
- booking_created
- booking_confirmed
- booking_cancelled

---

## 4. messaging-service
Owns:
- Conversations
- Messages
- Read receipts
- Attachment references

Database: `messaging`

No booking or listing logic.

Kafka: publishes immutable, versioned events to topic `messaging.events.v1` using `proto/events/messaging/v1/messaging_events.proto` (MessageSent, MessageReplied, MessageUpdated, MessageDeleted, MessageMarkedRead; plus PostCreated and CommentCreated).

---

## 5. notification-service
Consumes Kafka events only.

Sends:
- Booking confirmations
- Rent reminders
- Price drop alerts
- Review notifications

Stateless preferred.

---

## 6. trust-service
Owns:
- Reviews
- Rating aggregation
- Report abuse
- Moderation actions
- Listing flag state
- User suspension signals

Database: `trust`

Emits:
- listing_flagged
- user_suspended

---

## 7. analytics-service
Consumes Kafka events only.

Owns:
- Event aggregation
- Usage metrics
- Revenue metrics
- Platform insights

Never blocks request path.

---

# Communication Rules

- No service may directly query another service's database.
- Cross-domain interaction must use Kafka.
- Gateway may call services via REST or gRPC.
- Services may call auth-service for token validation only.

---

# Database Policy

Each service:
- Owns its own Postgres instance or schema.
- Owns its own Prisma schema.
- Has independent migrations.

No shared tables.

---

# Event-Driven Model

Example flow:

booking-service → Kafka → notification-service  
booking-service → Kafka → analytics-service  

listings-service → Kafka → analytics-service  

trust-service → Kafka → analytics-service  

All event contracts must be versioned.

---

# Common Package

services/common provides:
- Kafka client (mTLS enforced)
- Redis client
- Logger (Pino)
- Prometheus metrics
- gRPC helpers
- Shared utilities

No business logic allowed in common.

---

# Tech Stack

- Node 20
- pnpm workspace
- TypeScript strict
- Prisma
- KafkaJS
- ioredis
- Express or Fastify
- prom-client
- pino

---

# Scaling Philosophy

- Stateless services
- Horizontal scaling default
- State in Postgres, Redis, Kafka only
- Strict TLS everywhere
- No HTTP allowed

---

# Deployment

- Docker multi-stage builds
- Health endpoint: /health
- Metrics endpoint: /metrics
- CI builds per service
- Independent image tags

---

# Namespace & Hostname (cluster)

- **App namespace:** `off-campus-housing-tracker` (all housing services run here).
- **Hostname:** `off-campus-housing.test` (TLS, Caddy, and local DNS).
- **Other namespaces:** `ingress-nginx` and `envoy-test` are unchanged (shared infra).

---

# Postgres (local Docker)

This repo uses **5441–5448** for the eight housing DBs:

| Service                | Host port | DB name      |
|------------------------|-----------|--------------|
| auth-service           | 5441      | auth         |
| listings-service       | 5442      | listings     |
| booking-service        | 5443      | bookings     |
| messaging-service      | 5444      | messaging    |
| notification-service   | 5445      | notification |
| trust-service          | 5446      | trust        |
| analytics-service      | 5447      | analytics    |
| media-service          | 5448      | media        |

Start DBs with:

```bash
docker compose up -d postgres-auth postgres-listings postgres-bookings postgres-messaging postgres-notification postgres-trust postgres-analytics postgres-media
```

### Kafka domain topics (aligned with `proto/events`)

After Kafka is healthy (`docker compose up -d` — broker **29094** TLS), create partitions/topics and verify they match `proto/events/*`:

```bash
ENV_PREFIX=dev ./scripts/create-kafka-event-topics.sh
./scripts/verify-proto-events-topics.sh
pnpm run test:housing-wiring   # DB port defaults + builds (listings/trust/gateway)
```

**Listings** publishes to **`${ENV_PREFIX}.listing.events`** (same name the script creates). Wrap any protocol suite with capture: `./scripts/run-suite-with-packet-capture.sh ./scripts/test-listings-http2-http3.sh`.

**k3s images:** `./scripts/build-housing-images-k3s.sh` (build `:dev` + `colima ssh docker load`). After gateway/TLS/Dockerfile changes, rebuild and rollout: **`pnpm run rebuild:och:rollout`** (default **`api-gateway` + `media-service`**) or **`pnpm run rebuild:gateway:rollout`** for gateway only. Override: `SERVICES="auth-service api-gateway" pnpm run rebuild:och:rollout`. Set `ROLLOUT=0` to build/load only.

**Full ordering (Colima → infra → topics → images → deploy → tests):** [docs/RUN_PIPELINE_ORDER.md](docs/RUN_PIPELINE_ORDER.md).

**Makefile:** `make help` — one-shot **`make demo`** (stack + MetalLB preflight + suites) and **`make demo-network`** (adds SSL key log + standalone packet capture). Details: [docs/MAKE_DEMO.md](docs/MAKE_DEMO.md).

---

## No-conflict setup (same host as record platform)

**Optional (same host as other projects):** Use hostname **off-campus-housing.test** (SNI must match; do not use record-local). Redis **6380**, Kafka **29094**, Caddy NodePort **30444**, Zookeeper **2182**, Postgres **5441–5448** so this project does not conflict with other stacks. Deploy Caddy with **CADDY_NODEPORT=30444** when using NodePort so the port diff is applied (e.g. `CADDY_NODEPORT=30444 ./scripts/rollout-caddy.sh`).

**In-cluster service ports** for housing:

| Service        | Record platform (RP) | This project (housing)   |
|----------------|----------------------|--------------------------|
| API Gateway    | —                    | **4020**                 |
| Auth           | 4001 HTTP, 50051 gRPC | **4011** HTTP, **50061** gRPC |
| Records        | 4002 HTTP, 50051 gRPC | — (n/a)                  |
| Listings       | 4003 HTTP, 50057 gRPC | **4012** HTTP, **50062** gRPC |
| Analytics      | 4004 HTTP, 50054 gRPC | **4017** HTTP, **50067** gRPC |
| Booking        | —                    | **4013** HTTP, **50063** gRPC |
| Messaging      | —                    | **4014** HTTP, **50064** gRPC |
| Social         | 4006 HTTP, 50056 gRPC | — (n/a)                  |
| Shopping       | 4007 HTTP, 50058 gRPC | — (n/a)                  |
| Notification   | —                    | **4015** (event-only)    |
| Trust          | —                    | **4016** HTTP, **50066** gRPC |
| Media          | —                    | **4018** HTTP, **50068** gRPC |
| Auction Monitor| 4008 HTTP, 50059 gRPC | — (n/a)                  |
| Python AI      | 5005 HTTP, 50060 gRPC | — (n/a)                  |

Ensure manifests and Caddy/Envoy route to the gateway at **4020** and to these housing ports (4011–4018, 50061–50068).

**Gateway → media:** The API gateway proxies **`/api/media/*` and `/media/*` over HTTP** to **`MEDIA_HTTP`** (default `http://media-service…:4018`). That path is **not** gRPC; **50068** is the **gRPC + mTLS** API (`proto/media.proto`). Kafka/async shapes live under **`proto/events/`** (separate from RPC). Rationale and trade-offs: **[ENGINEERING.md](ENGINEERING.md)** → *Service Communication Patterns*.

**API Gateway probes (Kubernetes):** **`GET /healthz`** = liveness (process up). **`GET /readyz`** = readiness (auth gRPC `Health/Check` has succeeded); the server listens immediately and verifies auth in the background so the pod does not CrashLoop while auth is still starting. HAProxy `httpchk` uses **`/readyz`**. After CA rotation or simultaneous restarts, prefer **`./scripts/k8s-rollout-och-ordered.sh`** (auth → other services → gateway) instead of scaling ReplicaSets manually. Legacy **`aggressive-cleanup-replicasets.sh`** is a no-op unless **`OCH_AGGRESSIVE_RS_CLEANUP=1`**.

**MetalLB:** The pool must be on the **same L2 subnet as your node** (Colima often uses `192.168.64.x`). If the pool is wrong (e.g. `192.168.5.x` while the node is `192.168.64.x`), the Mac will see **HTTP 000** / timeouts to the LoadBalancer IP — fix with `./scripts/apply-metallb-pool-colima.sh` or set `METALLB_POOL` accordingly, then recreate `caddy-h3` if needed. For two clusters on one Mac, use a **different L2 pool** per cluster (e.g. `192.168.64.240-192.168.64.250` vs `251-260`). This project’s docker-compose uses Redis **6380**, Kafka **29094**, and Zookeeper **2182** by default. Use `CADDY_NODEPORT=30444` when deploying Caddy on a conflicting NodePort.

### Certs, secrets, and how to run tests (readable checklist)

**Full walkthrough:** **[docs/CERTS_AND_TESTING_FOR_MORTALS.md](docs/CERTS_AND_TESTING_FOR_MORTALS.md)** — generates every artifact the cluster expects (dev CA, edge leaf, service mTLS, Envoy client, Kafka files), loads K8s secrets, `/etc/hosts` + `--resolve` for curl/k6, messaging Vitest + Redis, and which scripts to run in order.

**After CA rotation:** **[docs/CA_ROTATION_AND_CLIENT_TRUST.md](docs/CA_ROTATION_AND_CLIENT_TRUST.md)** — gRPC probe tuning, Kafka external + Colima, ordered rollout, **k6 `--tls-ca-cert`**, dual-CA workflow.

---

# How to run (team / first-time)

Once the repo is set up and services are coded, use these steps so the whole team (and first-time users) can run the stack and tests.

## 1. One-time: create the cluster

- **Colima + k3s (recommended for Mac):**
  ```bash
  ./scripts/setup-new-colima-cluster.sh
  ```
  This starts Colima with k3s and installs MetalLB. Namespaces `ingress-nginx` and `envoy-test` stay as-is; the app runs in `off-campus-housing-tracker`. Hostname: `off-campus-housing.test`.

- **k3d:** Use your existing k3d workflow; ensure the cluster name/context matches what the scripts expect (e.g. `off-campus-housing-tracker`).

## 2. TLS + Edge (one command) — certs, Caddy, Envoy, namespaces

**Idiot-proof:** Run one script from repo root. It generates all certs, loads TLS secrets, and rolls out Caddy (2 pods) and Envoy (1 pod) with tcpdump in the images. No manual cert steps.

```bash
./scripts/setup-tls-and-edge.sh
```

This creates namespaces **ingress-nginx** (Caddy), **envoy-test** (Envoy), **off-campus-housing-tracker** (app pods), generates dev CA + Caddy leaf + Envoy client certs, builds **caddy-with-tcpdump** (xcaddy, HTTP/3) and **envoy-with-tcpdump**, and applies everything in order. See **[docs/TLS-AND-EDGE-SETUP.md](docs/TLS-AND-EDGE-SETUP.md)** for the full guide and troubleshooting. To verify HTTP/3: **`./scripts/verify-http3-edge.sh`** (checks Caddy h3 build, UDP 443, alt-svc, and `curl --http3`).

## 2b. Bring up external infra (every time you need DBs/Kafka/Redis)

Before running the app or tests, start Zookeeper, Kafka, Redis, and the 8 Postgres instances:

```bash
./scripts/bring-up-external-infra.sh
```

- Waits until ports 5441–5448 (Postgres), 6380 (Redis), and 29094 (Kafka SSL) are reachable.
- Kafka needs `certs/kafka-ssl` (see Runbook “Kafka SSL”); use `SKIP_KAFKA=1` to run without Kafka.
- Optional: restore from backup with `RESTORE_BACKUP_DIR=latest` or `RESTORE_BACKUP_DIR=backups/all-8-<timestamp>`.

### 2c. Build and load app images into Colima k3s (for k6 and in-cluster tests)

To run auth-, messaging-, and media-service in-cluster (and thus k6 + regular test suites), build the images and load them into Colima’s k3s:

```bash
# From repo root
docker build -f services/messaging-service/Dockerfile -t messaging-service:dev .
docker build -f services/media-service/Dockerfile -t media-service:dev .
# Optional: docker build -f services/auth-service/Dockerfile -t auth-service:dev .

# Load into Colima k3s so the cluster can use them
docker save messaging-service:dev | colima ssh -- docker load
docker save media-service:dev | colima ssh -- docker load
# docker save auth-service:dev | colima ssh -- docker load

# Deploy base stack (includes auth-, messaging-, media-service)
kubectl apply -k infra/k8s/base
```

Ensure `app-config` ConfigMap and `app-secrets` provide DB hosts (e.g. `host.docker.internal` for Postgres 5441–5448) and `REDIS_URL`. Then run preflight and suites (step 4).

### 2d. Caddy H3 (2 pods) and Envoy (1 pod) with strict TLS/mTLS

If you didn’t use the one-shot script in step 2, you can bring up Caddy and Envoy manually. For preflight and k6/strict-TLS tests, they must run with certs in the right namespaces:

| Namespace                     | Workload   | Replicas | Secrets (strict TLS/mTLS)        |
|------------------------------|------------|----------|-----------------------------------|
| **ingress-nginx**             | Caddy H3   | 2        | `off-campus-housing-local-tls`, `dev-root-ca` |
| **envoy-test**                | Envoy      | 1        | `dev-root-ca`, `envoy-client-tls` |
| **off-campus-housing-tracker**| App services | per deploy | `app-config`, `app-secrets`, optional `service-tls` |

From repo root (after certs exist in `./certs/`):

```bash
./scripts/ensure-caddy-envoy-strict-tls.sh
```

This ensures namespaces, TLS secrets, Caddy deploy (LoadBalancer on Colima+MetalLB, else NodePort), Envoy deploy, scales Caddy to 2 and Envoy to 1, and waits for rollouts. To create certs first: `./scripts/dev-generate-certs.sh`, then `./scripts/generate-envoy-client-cert.sh`, then `./scripts/strict-tls-bootstrap.sh`. Or run the one-shot: `./scripts/setup-tls-and-edge.sh`. Then run `./scripts/run-preflight-scale-and-all-suites.sh`. Verify: `./scripts/verify-metallb-and-traffic-policy.sh`.

## 3. One person testing their part

- Start only what you need:
  - **Just Postgres for one service:**  
    `docker compose up -d postgres-auth` (or `postgres-listings`, etc.).
  - **Full infra (no Kafka):**  
    `SKIP_KAFKA=1 ./scripts/bring-up-external-infra.sh`
- Then run your service locally or deploy to the cluster and hit it via the gateway or health endpoints.

## 4. Full preflight and test suites

After cluster + infra are up, you can run the full preflight (images, TLS, Caddy, Envoy, DBs) and the **housing + protocol** test suites (auth, rotation, standalone capture, TLS/mTLS only — no legacy social/shopping suites):

```bash
./scripts/run-preflight-scale-and-all-suites.sh
```

- Set `RUN_SUITES=0` to only bring up the cluster/infra and skip test suites.
- **`PREFLIGHT_APP_SCOPE=core`** — preflight only **scales and waits** for `auth-service`, `api-gateway`, `messaging-service`, and `media-service` (avoids hanging on listings/booking/trust/analytics when you are not running them). Default is `full` (all app deployments in the wait list).
- **`RUN_MESSAGING_LOAD=0`** — skip the short **k6** messaging + media health phase after Vitest + shell suites (default `1` when `k6` is on `PATH` and `certs/dev-root.pem` + LB IP exist).
- Set `RUN_K6=1` inside **`run-all-test-suites.sh`** flows for heavier rotation/k6 (this preflight wrapper exits after housing suites; see script header).

Preflight step **7a** runs, in order: **`pnpm -C services/messaging-service test`** and **`pnpm -C services/media-service test`** (Vitest, under each service’s `tests/`), **`scripts/test-microservices-http2-http3-housing.sh`** (auth + messaging + media health, gRPC, latency SVG), **`scripts/test-messaging-service-comprehensive.sh`** (messaging/forum via edge; `test-social-service-comprehensive.sh` is a deprecated wrapper), then optional **k6** `scripts/load/k6-messaging.js` + `scripts/load/k6-media-health.js` + **`scripts/load/k6-event-layer-adversarial.js`** (event-layer companion / adversarial edge load when using `run-k6-all-services.sh`).

For a **housing-only** HTTP/2 + HTTP/3 smoke (auth register/login, messaging, media checks), run **`./scripts/test-microservices-http2-http3-housing.sh`**. For more detail see **Runbook.md**, **`docs/CERTS_AND_TESTING_FOR_MORTALS.md`**, and the comments in `scripts/run-preflight-scale-and-all-suites.sh`.

### Strict TLS k6 and HTTP/3 (xk6-http3)

- **Root Dockerfiles for strict TLS k6**  
  `Dockerfile.k6-strict-tls` and `Dockerfile.k6-strict-tls-v2` build a k6 image with the dev CA (`certs/dev-root.pem`) so runs can use strict TLS (no `--insecure-skip-tls-verify`). Prefer **v2** (updates the system CA store; v1 only copies the cert). Build from repo root:
  ```bash
  docker build -f Dockerfile.k6-strict-tls-v2 -t k6-strict-tls:dev .
  ```
  Use this image for in-cluster k6 jobs that talk to Caddy with strict TLS.

- **xk6-http3**  
  HTTP/3 load phases use a custom k6 binary built with the xk6-http3 extension. Preflight step 6d builds it when `RUN_K6=1` (or run manually):
  ```bash
  ./scripts/build-k6-http3.sh   # produces .k6-build/bin/k6-http3 (pins k6 core + bandorko/xk6-http3; see script)
  ```
  Use that binary (or an image that includes it) for k6 scripts that call `k6/x/http3`. The two root Dockerfiles above do not include xk6-http3; for host-based strict TLS + HTTP/3, use the built binary with `SSL_CERT_FILE=$PWD/certs/dev-root.pem` (or equivalent). Details: **[docs/XK6_HTTP3_SETUP.md](docs/XK6_HTTP3_SETUP.md)**. Dev hostname + `/etc/hosts`: **[docs/DEV_HOSTNAME.md](docs/DEV_HOSTNAME.md)**.

---

# Future Splits (When Scaling Demands It)

listings-service → split search-index-service  
trust-service → split moderation-service  

Do not split prematurely.

---

# Non-Negotiables

- No cross-service DB access
- No business logic in gateway
- No synchronous dependency chains across domains
- No coupling analytics into request path
