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

For detailed technical documentation, system design, and architectural decisions, see [**ENGINEERING.md**](ENGINEERING.md).

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
│                    host: off-campus-housing.local                            │
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
        │  │ Analytics    │         │                 │             │
        │  │ Svc (4017)   │         │                 │             │
        │  │ gRPC:50067   │         │                 │             │
        │  │ HTTP:4017    │         │                 │             │
        │  └──────────────┘         │                 │             │
        └───────────────────────────┼─────────────────┼─────────────┘
                                  │
                                  │ gRPC/HTTP
                                  │
        ┌─────────────────────────┴─────────────────────────────────────┐
        │              External Databases (Docker Compose)              │
        │                    (Outside Kubernetes)                       │
        ├───────────────────────────────────────────────────────────────┤
        │  Ports 5441–5447 (Postgres)                                   │
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
        │  ┌──────────────┐  ┌──────────────┐                         │
        │  │ Postgres     │  │    Redis     │                         │
        │  │ Analytics    │  │   (6380)     │                         │
        │  │   (5447)     │  │ - JWT Cache  │                         │
        │  │ - analytics  │  │ - Search     │                         │
        │  └──────────────┘  └──────────────┘                         │
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

We implement 7 core services:

1. auth-service
2. listings-service
3. booking-service
4. messaging-service
5. notification-service
6. trust-service
7. analytics-service

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
- **Hostname:** `off-campus-housing.local` (TLS, Caddy, and local DNS).
- **Other namespaces:** `ingress-nginx` and `envoy-test` are unchanged (shared infra).

---

# Postgres (local Docker)

This repo uses **5441–5447** for the seven housing DBs:

| Service                | Host port | DB name      |
|------------------------|-----------|--------------|
| auth-service           | 5441      | auth         |
| listings-service       | 5442      | listings     |
| booking-service        | 5443      | bookings     |
| messaging-service      | 5444      | messaging    |
| notification-service   | 5445      | notification |
| trust-service          | 5446      | trust        |
| analytics-service      | 5447      | analytics    |

Start DBs with:

```bash
docker compose up -d postgres-auth postgres-listings postgres-bookings postgres-messaging postgres-notification postgres-trust postgres-analytics
```

---

## No-conflict setup (same host as record platform)

**Optional (same host as other projects):** Use hostname **off-campus-housing.local** (SNI must match; do not use record-local). Redis **6380**, Kafka **29094**, Caddy NodePort **30444**, Zookeeper **2182**, Postgres **5441–5447** so this project does not conflict with other stacks. Deploy Caddy with **CADDY_NODEPORT=30444** when using NodePort so the port diff is applied (e.g. `CADDY_NODEPORT=30444 ./scripts/rollout-caddy.sh`).

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
| Auction Monitor| 4008 HTTP, 50059 gRPC | — (n/a)                  |
| Python AI      | 5005 HTTP, 50060 gRPC | — (n/a)                  |

Ensure manifests and Caddy/Envoy route to the gateway at **4020** and to these housing ports (4011–4017, 50061–50067).

**MetalLB:** Use a **different L2 pool** so both clusters do not claim the same IPs. For this project set `METALLB_POOL=192.168.64.251-192.168.64.260` before running `./scripts/setup-new-colima-cluster.sh` (record platform typically uses `192.168.64.240-192.168.64.250`). This project’s docker-compose uses Redis **6380**, Kafka **29094**, and Zookeeper **2182** by default (no conflict with RP). Use `CADDY_NODEPORT=30444` when deploying Caddy.

---

# How to run (team / first-time)

Once the repo is set up and services are coded, use these steps so the whole team (and first-time users) can run the stack and tests.

## 1. One-time: create the cluster

- **Colima + k3s (recommended for Mac):**
  ```bash
  ./scripts/setup-new-colima-cluster.sh
  ```
  This starts Colima with k3s and installs MetalLB. Namespaces `ingress-nginx` and `envoy-test` stay as-is; the app runs in `off-campus-housing-tracker`. Hostname: `off-campus-housing.local`.

- **k3d:** Use your existing k3d workflow; ensure the cluster name/context matches what the scripts expect (e.g. `off-campus-housing-tracker`).

## 2. Bring up external infra (every time you need DBs/Kafka/Redis)

Before running the app or tests, start Zookeeper, Kafka, Redis, and the 7 Postgres instances:

```bash
./scripts/bring-up-external-infra.sh
```

- Waits until ports 5441–5447 (Postgres), 6380 (Redis), and 29094 (Kafka SSL) are reachable.
- Kafka needs `certs/kafka-ssl` (see Runbook “Kafka SSL”); use `SKIP_KAFKA=1` to run without Kafka.
- Optional: restore from backup with `RESTORE_BACKUP_DIR=latest` or `RESTORE_BACKUP_DIR=backups/all-7-<timestamp>`.

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
- Set `RUN_K6=1` to run k6 load after the rotation suite.
- Suites run: **auth**, **rotation** (CA/leaf + protocol verification), **standalone-capture** (wire capture), **tls-mtls** (cert chain, gRPC TLS, mTLS).

For more detail see the Runbook and comments in `scripts/run-all-test-suites.sh` and `scripts/run-preflight-scale-and-all-suites.sh`.

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
