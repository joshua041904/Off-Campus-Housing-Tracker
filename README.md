# Housing Platform — Global-Scale Architecture (v1)

## Vision

This is a global-scale housing marketplace platform (Airbnb-class ambition).

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

Host ports **5432–5440** are used by another project. This repo uses **5441–5447** for the seven housing DBs:

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
