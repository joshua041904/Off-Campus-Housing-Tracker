# Housing Platform — Repo Setup Spec (v1 Global-Scale Ready)

**Drop this into the new housing-platform repo.** Use it as the single source of truth for what to build and how. Paste the Cursor instruction block (§Cursor instruction block) into Cursor to scaffold.

---

## Objective

Create a new repository: **housing-platform/**

This repository will:

- Use the substrate infra (Caddy, Envoy, MetalLB, strict TLS, Kafka mTLS)
- Implement **7 domain services** (global-scale ready)
- Be **fully event-driven**
- Be **independently deployable**
- Be **CI-ready**
- Be **horizontally scalable**

---

## Root Structure

```
housing-platform/
├── services/
│   ├── common/
│   ├── auth-service/
│   ├── listings-service/
│   ├── booking-service/
│   ├── messaging-service/
│   ├── notification-service/
│   ├── trust-service/
│   └── analytics-service/
├── webapp/
├── proto/
├── infra/
│   └── k8s/
│       ├── base/
│       └── overlays/
├── scripts/
├── docs/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── docker-compose.yml
```

**infra:** Substrate bundle provides `infra/k8s` (base = substrate only: namespaces, config, kafka-external, kafka, envoy-test, redis, haproxy, nginx, observability, monitoring, exporters). **You add** `infra/k8s/base/<service>/` per service (api-gateway, auth-service, listings-service, etc.) and register them in `base/kustomization.yaml`. No `infra/db` or `infra/ansible` in the bundle; DBs and migrations are per-project.

---

## Service Responsibilities (Non-Negotiable Boundaries)

### 1. auth-service

**Owns:** Users, roles (tenant, landlord, admin), JWT, account state, MFA / passkeys  
**DB:** `auth`  
No other service touches this DB.

### 2. listings-service

**Owns:** Listings, geolocation, pricing, availability, search index, filtering (price, distance, tags), image metadata  
**DB:** `listings`  
No booking logic here.

### 3. booking-service

**Owns:** Reservation state machine, booking lifecycle, cancellation, landlord approval, payment status (future)  
**DB:** `bookings`  
**Emits Kafka:** `booking_created`, `booking_confirmed`, `booking_cancelled`

### 4. messaging-service

**Owns:** Conversations, messages, read receipts, attachments (references only)  
**DB:** `messaging`  
No booking logic inside.

### 5. notification-service

**Owns:** Email / push dispatch, rent reminders, price drop alerts  
Consumes **Kafka events only**. No direct REST dependencies. Stateless preferred.

### 6. trust-service

**Owns:** Reviews, ratings aggregation, report abuse, admin moderation, listing flag state  
**DB:** `trust`  
**Can emit:** `user_suspended`, `listing_flagged`

### 7. analytics-service

**Owns:** Event aggregation, platform metrics, revenue tracking, usage insights  
Consumes **Kafka only**. Never in request path.

---

## Event-Driven Architecture (Mandatory)

All cross-domain interactions must go through Kafka.

**Examples:**

- **Booking created:** booking-service → Kafka → notification-service, analytics-service, trust-service (future fraud)
- **Listing updated:** listings-service → Kafka → analytics-service
- **Review added:** trust-service → Kafka → analytics-service

**No synchronous chaining across domains.**

---

## Database Policy

- Each service has its own Postgres instance or schema.
- Each service has its own Prisma schema.
- No shared DB tables.
- No cross-service direct DB queries.

**Hard rule.**

---

## API Gateway Rules

- Auth middleware
- Rate limiting
- gRPC proxying (optional)
- REST entrypoint  
**No business logic.**

---

## Common Package

**services/common** must provide:

- Kafka client (mTLS)
- Redis client
- Logger (Pino)
- Metrics (Prometheus)
- gRPC helpers
- Proto loader  

**No business logic in common.**

---

## Technology Stack

- Node 20
- pnpm workspace
- TypeScript strict mode
- Prisma
- KafkaJS
- ioredis
- Express or Fastify
- prom-client
- Pino logger

---

## CI Requirements

**Each service must:**

- Build independently
- Have Dockerfile
- Have health endpoint `/health`
- Have metrics endpoint `/metrics`

**CI must:**

- Build matrix per service
- Docker build matrix
- Run tests
- Validate no IP-based HTTP/3
- Validate strict TLS config

---

## Docker Rules

**Each service Dockerfile:**

- Multi-stage build
- `pnpm install --frozen-lockfile`
- Build common first, then build service
- Production-only install
- Non-root user
- Healthcheck defined

---

## Security Rules (Global-Scale Grade)

- Strict TLS only
- Kafka mTLS required
- No HTTP allowed
- CORS restricted
- JWT validation in gateway
- Rate limiting per IP and per user
- Helmet middleware
- Input validation everywhere

---

## Scaling Philosophy

- Stateless services only.
- State in: Postgres, Redis, Kafka.
- Horizontal scaling default.

---

## Versioning Strategy

- Each service versioned independently
- Docker image tagged per service
- CI pushes images to registry

---

## Phase 1 Implementation Order

1. auth-service (ported)
2. listings-service
3. booking-service
4. messaging-service
5. notification-service
6. trust-service
7. analytics-service  
**Webapp last.**

---

## Important Cursor Instruction

- Do **NOT** over-couple services.
- Do **NOT** introduce cross-service DB access.
- Do **NOT** move logic into gateway.
- Follow strict TypeScript config.
- Follow workspace linking using pnpm.

---

## What to Build (Summary)

1. **Scaffold services** — one directory per service with package.json, tsconfig.json, Dockerfile, src/server.ts, /health, /metrics, Prisma schema, Kafka via common.
2. **Create workspace config** — root package.json, pnpm-workspace.yaml, tsconfig.base.json, docker-compose.yml (Postgres + Kafka + Redis only).
3. **Implement services/common** — Kafka client (SSL/mTLS), Redis, Pino logger, Prometheus metrics helper, gRPC helpers; no business logic.
4. **Scaffold minimal REST** — auth: register/login; listings: create/get listing; booking: create booking; messaging: send message; trust: add review; notification & analytics: event consumer only.
5. **Prepare CI** — build matrix per service, Docker build matrix, tests, strict TLS validation.
6. **Add infra/k8s/base/\<service\>** — one deploy + service per app; register in base/kustomization.yaml; add HPA in overlays/dev as needed.

**Stop after scaffolding. Do not implement full business logic.**

---

## Cursor Instruction Block

Paste the following into Cursor as the scaffolding instruction:

```
You are setting up a new repository: housing-platform.

Follow ARCHITECTURE.md and this REPO_SETUP_SPEC strictly.

Tasks:

1. Create pnpm workspace structure:
   - services/common, auth-service, listings-service, booking-service, messaging-service, notification-service, trust-service, analytics-service
   - webapp/, proto/, infra/k8s/base, scripts/, docs/

2. Create root: package.json (workspace root), pnpm-workspace.yaml, tsconfig.base.json, docker-compose.yml (Postgres + Kafka + Redis only).

3. Each service must include: package.json, tsconfig.json, Dockerfile (multi-stage), src/server.ts, health endpoint (/health), metrics endpoint (/metrics), Prisma schema, Kafka client usage via services/common, Logger via services/common.

4. Implement services/common: Kafka client with SSL/mTLS support, Redis client, Pino logger, Prometheus metrics helper. No business logic.

5. Enforce: TypeScript strict mode, no cross-service imports, no shared DB schemas, no business logic in gateway.

6. Scaffold minimal REST: auth register/login; listings create/get listing; booking create booking; messaging send message; trust add review; notification and analytics event consumer only.

7. Do not over-couple services. Do not create cross-service database queries. Do not introduce synchronous chains between services.

8. Prepare CI-ready Docker builds.

Stop after scaffolding. Do not implement full business logic.
```

---

## Final Strategic Advice

You are building a **platform**, not an app.

- Design domain isolation now.
- Optimize later. Split later.
- **Never entangle domains.**
