# Design & domain model

This document is the **design reference** for architecture diagrams (decomposed), service ownership, communication rules, and related runtime layout. For engineering deep-dives (decisions, security, IaC), see [**ENGINEERING.md**](../ENGINEERING.md). For **how to build and run** the repo, see [**README.md**](../README.md).

---

## Architecture (decomposed)

The former single large diagram is split by layer. Numbers and ports match the housing stack in `infra/k8s`.

### 1. Client and edge termination

```
┌─────────────────────────────────────────┐
│  Browser / mobile / API clients        │
│  HTTP/3 (QUIC) · HTTP/2 · HTTP/1.1    │
│  gRPC (to Envoy)                        │
└──────────────────┬──────────────────────┘
                   │
     ┌─────────────┴─────────────┐
     ▼                           ▼
┌─────────────┐           ┌─────────────┐
│ Caddy (H3)  │           │ Envoy       │
│ TLS edge    │           │ gRPC :10000 │
│ Web + /api* │           │             │
└──────┬──────┘           └──────┬──────┘
       └────────────┬────────────┘
                    ▼
```

### 2. In-cluster routing (`off-campus-housing.test`)

```
┌─────────────────────────────────────────┐
│  ingress-nginx                          │
│  host: off-campus-housing.test         │
└──────────────────┬────────────────────┘
         ┌─────────┴─────────┐
         ▼                   ▼
   /api, /auth          / (static)
         │                   │
         ▼                   ▼
┌─────────────────┐   ┌──────────────┐
│ api-gateway     │   │ nginx :8080  │
│ :4020           │   │ micro-cache  │
└────────┬────────┘   └──────┬───────┘
         │                    │
         └────────┬───────────┘
                  ▼
```

### 3. Gateway to microservices

```
┌─────────────────┐
│ HAProxy :8081   │  keep-alive, fan-in to services
└────────┬────────┘
         ▼
┌─────────────────────────────────────────────────────────┐
│  Namespace: off-campus-housing-tracker                  │
│  auth · listings · booking · messaging · notification   │
│  trust · analytics · media  (HTTP + gRPC per service)    │
└─────────────────────────────────────────────────────────┘
```

### 4. Data and messaging (local dev typical layout)

```
┌─────────────────────────────────────────┐
│  Postgres per domain  :5441–5448       │
│  Redis                  :6380            │
│  Kafka (in-cluster      KRaft :9093 SSL) │
│  Docker Compose: DBs + Redis; Kafka k8s  │
└─────────────────────────────────────────┘
```

### 5. Observability (Kubernetes)

```
Prometheus · Grafana · Jaeger · OpenTelemetry Collector
```

### 6. Automation

```
Terraform / Ansible where used · Makefile · scripts (see ENGINEERING.md, Runbook.md)
```

---

## High-level architecture

Services are **domain-based**, not feature-based.

Eight core services:

1. auth-service  
2. listings-service  
3. booking-service  
4. messaging-service  
5. notification-service  
6. trust-service  
7. analytics-service  
8. media-service  

Cross-service coordination uses **Kafka events** (versioned contracts under `proto/events/`).

---

## Service responsibilities

### 1. auth-service

**Owns:** User accounts; roles (tenant, landlord, admin); JWT issuance/validation; account state; MFA / passkeys.  
**Database:** `auth` — no other service may access it.

### 2. listings-service

**Owns:** Listings, pricing, geolocation, availability, filtering, search indexing, image metadata references.  
**Database:** `listings` — no booking logic.

### 3. booking-service

**Owns:** Reservation state machine, lifecycle, cancellation, landlord approval, payment (future).  
**Database:** `bookings`  
**Events (examples):** `booking_created`, `booking_confirmed`, `booking_cancelled`

### 4. messaging-service

**Owns:** Conversations, messages, read receipts, attachment references.  
**Database:** `messaging`  
**Kafka:** e.g. `messaging.events.v1` from `proto/events/messaging/v1/messaging_events.proto`.

### 5. notification-service

**Consumes Kafka only.** Sends booking confirmations, reminders, price-drop alerts, review notifications. Prefer stateless.

### 6. trust-service

**Owns:** Reviews, ratings, abuse reports, moderation, listing flags, suspension signals.  
**Database:** `trust`  
**Events (examples):** `listing_flagged`, `user_suspended`

### 7. analytics-service

**Consumes Kafka only.** Aggregation, usage/revenue metrics, insights. Must not block the request path.

### 8. media-service

**Owns:** Media upload and metadata (see service README and protos).

---

## Communication rules

- No service queries another service’s database.
- Cross-domain interaction uses **Kafka**.
- Gateway may call services over REST or gRPC.
- Services may call **auth** for token validation only.

---

## Database policy

- Each service owns its Postgres instance/schema, Prisma schema, and migrations.
- **No shared tables** across domains.

---

## Event-driven model

Examples:

- `booking-service` → Kafka → `notification-service`, `analytics-service`
- `listings-service` → Kafka → `analytics-service`
- `trust-service` → Kafka → `analytics-service`

All event contracts must be **versioned**.

---

## Common package (`services/common`)

Shared: Kafka client (mTLS), Redis, Pino logger, Prometheus metrics, gRPC helpers, utilities. **No business logic.**

---

## Tech stack (services)

- Node 20 · pnpm workspace · TypeScript strict · Prisma · KafkaJS · ioredis · Express/Fastify · prom-client · pino  

(Edge and cluster components: Caddy, Envoy, nginx, HAProxy, ingress-nginx — see ENGINEERING.md.)

---

## Scaling philosophy

- Stateless services, horizontal scaling by default  
- State in Postgres, Redis, Kafka only  
- Strict TLS; no ad-hoc HTTP shortcuts  

---

## Deployment conventions

- Docker multi-stage images per service  
- Health: `/health` or service-specific probes; metrics: `/metrics` where applicable  
- CI builds per service; independent image tags  

---

## Namespace and hostname

- **App namespace:** `off-campus-housing-tracker`  
- **Edge hostname:** `off-campus-housing.test`  
- **Shared infra:** `ingress-nginx`, `envoy-test`  

---

## Postgres (local Docker)

| Service              | Host port | DB name      |
|----------------------|-----------|--------------|
| auth-service         | 5441      | auth         |
| listings-service     | 5442      | listings     |
| booking-service      | 5443      | bookings     |
| messaging-service    | 5444      | messaging    |
| notification-service | 5445      | notification |
| trust-service        | 5446      | trust        |
| analytics-service    | 5447      | analytics    |
| media-service        | 5448      | media        |

Example:

```bash
docker compose up -d postgres-auth postgres-listings postgres-bookings postgres-messaging postgres-notification postgres-trust postgres-analytics postgres-media
```

---

## Kafka topics and wiring

After in-cluster KRaft brokers are Ready (`kafka-0` … `kafka-2`):

```bash
ENV_PREFIX=dev ./scripts/create-kafka-event-topics-k8s.sh
./scripts/verify-proto-events-topics.sh
pnpm run test:housing-wiring
```

**Listings** uses `${ENV_PREFIX}.listing.events` (aligned with `proto/events`). Full ordering: [**RUN_PIPELINE_ORDER.md**](RUN_PIPELINE_ORDER.md).

---

## k3s images and rollouts

- `./scripts/build-housing-images-k3s.sh` — build `:dev` and load into Colima k3s  
- **`pnpm run rebuild:och:rollout`** (default gateway + media) or **`pnpm run rebuild:gateway:rollout`**  
- Override: `SERVICES="auth-service api-gateway" pnpm run rebuild:och:rollout`  

---

## Makefile demos

- **`make help`** — all documented targets  
- **`make demo`** / **`make demo-network`** — see [**MAKE_DEMO.md**](MAKE_DEMO.md)  

---

## No-conflict setup (shared laptop)

Use hostname **off-campus-housing.test**, Redis **6380**, Caddy NodePort **30444** (when needed), Postgres **5441–5448**. Kafka runs **in k3s**, not host Compose. Example: `CADDY_NODEPORT=30444 ./scripts/rollout-caddy.sh`.

### In-cluster HTTP/gRPC ports (housing vs other platforms)

| Service        | This project (housing)        |
|----------------|-------------------------------|
| API Gateway    | **4020** HTTP                 |
| Auth           | **4011** HTTP, **50061** gRPC |
| Listings       | **4012** HTTP, **50062** gRPC |
| Booking        | **4013** HTTP, **50063** gRPC |
| Messaging      | **4014** HTTP, **50064** gRPC |
| Notification   | **4015** (event-heavy)        |
| Trust          | **4016** HTTP, **50066** gRPC |
| Analytics      | **4017** HTTP, **50067** gRPC |
| Media          | **4018** HTTP, **50068** gRPC |

**Gateway → media:** HTTP proxy for **`/api/media/*`** and **`/media/*`** to **`MEDIA_HTTP`** (default `http://media-service…:4018`). **50068** is gRPC + mTLS (`proto/media.proto`). Event shapes: **`proto/events/`**. Rationale: [**ENGINEERING.md**](../ENGINEERING.md) → *Service Communication Patterns*.

### API gateway probes

- **`GET /healthz`** — liveness  
- **`GET /readyz`** — readiness (auth gRPC health)  
- HAProxy `httpchk` uses **`/readyz`**. After CA rotation: **`./scripts/k8s-rollout-och-ordered.sh`**.

### MetalLB

Pool must be on the **same L2 subnet** as the node (Colima often `192.168.64.x`). Wrong pool → timeouts to the LB IP. Fix: `./scripts/apply-metallb-pool-colima.sh` or adjust `METALLB_POOL`. See [**ENGINEERING.md**](../ENGINEERING.md) and Runbook.

---

## TLS, certs, and testing

- [**LOCAL_TLS_AND_TESTING_GUIDE.md**](LOCAL_TLS_AND_TESTING_GUIDE.md)  
- [**CA_ROTATION_AND_CLIENT_TRUST.md**](CA_ROTATION_AND_CLIENT_TRUST.md)  

---

## Detailed runbooks (team / first-time)

These complement **`make up`** in the README.

1. **Cluster:** `./scripts/setup-new-colima-cluster.sh` (or k3d equivalent).  
2. **TLS + edge (one shot):** `./scripts/setup-tls-and-edge.sh` — see [**TLS-AND-EDGE-SETUP.md**](TLS-AND-EDGE-SETUP.md). HTTP/3 check: `./scripts/verify-http3-edge.sh`.  
3. **External infra:** `./scripts/bring-up-external-infra.sh` (Postgres, Redis, MinIO; optional `WAIT_K8S_KAFKA=1`).  
4. **Images:** build/load as in **k3s images** above; apply `kubectl apply -k infra/k8s/base` after brokers if using KRaft.  
5. **Caddy/Envoy only:** `./scripts/ensure-caddy-envoy-strict-tls.sh` if not using the one-shot TLS script.  
6. **Full preflight + suites:** `./scripts/run-preflight-scale-and-all-suites.sh` — see script header for `RUN_SUITES`, `PREFLIGHT_APP_SCOPE`, `RUN_MESSAGING_LOAD`, etc.  
7. **Strict TLS k6:** `Dockerfile.k6-strict-tls-v2`, [**XK6_HTTP3_SETUP.md**](XK6_HTTP3_SETUP.md), [**DEV_HOSTNAME.md**](DEV_HOSTNAME.md).  

---

## Future splits (when scaling demands)

- `listings-service` → optional `search-index-service`  
- `trust-service` → optional `moderation-service`  

Do not split prematurely.

---

## Non-negotiables

- No cross-service database access  
- No business logic in the gateway  
- No synchronous dependency chains across domains  
- No coupling analytics into the synchronous request path  
