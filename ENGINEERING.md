**Cluster-only focus:** This copy is for Kubernetes cluster operations, TLS/mTLS, Caddy/Envoy, MetalLB, and runbook issues. Application/product specifics are in README.md.

# Off-Campus-Housing-Tracker — Engineering Documentation

This document provides in-depth technical documentation for the Off-Campus-Housing-Tracker architecture, design decisions, and implementation details. For a high-level overview, see [`README.md`](README.md). *Last updated to reflect Colima k3s primary, 8-DB housing (5441–5448) deterministic restore and schema inspection, preflight step 7c (in-cluster k6), and Runbook 79–80.*

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Design Decisions](#design-decisions)
3. [Technology Stack](#technology-stack)
4. [Data Flow Diagrams](#data-flow-diagrams)
5. [Service Communication Patterns](#service-communication-patterns)
6. [Infrastructure as Code](#infrastructure-as-code)
7. [Observability & Monitoring](#observability--monitoring)
8. [Performance Optimizations](#performance-optimizations)
9. [Security Architecture](#security-architecture)
10. [Deployment Strategy](#deployment-strategy)

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Client Layer                                       │
│                    HTTP/3 (QUIC) | HTTP/2 | HTTP/1.1 | gRPC                  │
│                    Web App (Next.js) | Mobile | API Clients                 │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                      │
        HTTP/3 + Web + REST                    gRPC Requests
                    │                                      │
                    ▼                                      ▼
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│      Edge Layer (Caddy)          │      │      gRPC Proxy (Envoy)            │
│  TLS Termination (TLS 1.2/1.3)   │      │  First-Class gRPC Support         │
│  HTTP/2 + HTTP/3 (QUIC)          │      │  HTTP/2 with TLS                  │
│  NodePort: 30443 or LoadBalancer  │      │  Port: 10000                      │
│  (MetalLB LB IP when enabled)    │      │  Never routes through HTTP        │
│  Architecture:                   │      │  Preserves trailers correctly     │
│  - NodePort / LoadBalancer       │      │  Forbids HTTP error pages          │
│  - Multiple replicas              │      │  Enforces HEADERS/DATA ordering   │
│  - RollingUpdate (maxUnavailable=0)│     │                                  │
│  - Pod Anti-Affinity              │      │  Features:                       │
│                                  │      │  - First-class gRPC awareness     │
│  Features:                       │      │  - No HTTP handler interference   │
│  - Zero-downtime CA rotation      │      │  - Trailer preservation            │
│  - Strict TLS (1.2/1.3 only)     │      │  - Error handling for gRPC         │
│  - QUIC (HTTP/3) support          │      │  - Proven functionality            │
│  - Web App (Next.js)              │      │                                  │
│  - REST API (/api/*)              │      │  Decision: Envoy for gRPC,        │
│  - Static Assets                  │      │  Caddy for HTTP/3 + web + REST     │
└──────────────────┬───────────────┘      └──────────────────┬───────────────┘
                   │                                          │
                   └──────────────────┬──────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Kubernetes Ingress Layer                                 │
│                    ingress-nginx (Kubernetes Cluster)                        │
│                         host: off-campus-housing.local                                  │
│                                                                              │
│  Routing Rules:                                                              │
│  - / → Nginx Edge (static assets + micro-cache)                            │
│  - /api/* → API Gateway (JWT verification + gRPC proxy)                    │
│  - gRPC requests → Envoy (port 10000) → gRPC services                      │
└──────────────────────┬───────────────────────────┬──────────────────────────┘
                       │                           │
        REST /api/*    │                           │  gRPC /service.*
        (HTTP/2/3)     │                           │  (HTTP/2 TLS via Envoy)
                       ▼                           ▼
        ┌──────────────────────┐      ┌──────────────────────────────┐
        │  Nginx Edge (8080)   │      │    API Gateway (4020)        │
        │  - Static Assets     │      │    - JWT Verification        │
        │  - Micro-cache       │──────▶│    - Rate Limiting          │
        │  - Rate Limiting     │      │    - Identity Injection      │
        └──────────────────────┘      │    - HTTP → gRPC Proxy       │
                       │               └──────────────┬───────────────┘
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
        │              Microservices Layer (Kubernetes)               │
        ├─────────────────────────────────────────────────────────────┤
        │                                                              │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
        │  │ Auth Service │  │Records Service│  │Listings Service│    │
        │  │   (4001)     │  │    (4002)    │  │    (4003)    │     │
        │  │ gRPC:50051   │  │ gRPC:50051   │  │ gRPC:50057   │     │
        │  │ HTTP:4001    │  │ HTTP:4002    │  │ HTTP:4003    │     │
        │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
        │         │                 │                 │              │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
        │  │Analytics     │  │Social Service│  │Shopping      │     │
        │  │Service (4004)│  │    (4006)    │  │Service (4007)│     │
        │  │ gRPC:50054   │  │ gRPC:50056   │  │ gRPC:50058   │     │
        │  │ HTTP:4004    │  │ HTTP:4006    │  │ HTTP:4007    │     │
        │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
        │         │                 │                 │              │
        │  ┌──────────────┐  ┌──────────────┐                        │
        │  │Auction Monitor│  │Python AI     │                        │
        │  │    (4008)    │  │Service (5005)│                        │
        │  │ gRPC:50059   │  │ gRPC:50060   │                        │
        │  │ HTTP:4008    │  │ HTTP:5005    │                        │
        │  └──────────────┘  └──────────────┘                        │
        └─────────────────────────────────────────────────────────────┘
                                  │
                                  │ gRPC/HTTP
                                  │
        ┌─────────────────────────┴─────────────────────────────────────┐
        │              Data Layer (External - Docker Compose)          │
        │                    (Outside Kubernetes)                       │
        ├───────────────────────────────────────────────────────────────┤
        │                                                               │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
        │  │Postgres Auth │  │Postgres      │  │Postgres      │       │
        │  │   (5441)     │  │Listings(5442)│  │Bookings(5443)│       │
        │  │ - auth       │  │ - listings   │  │ - bookings   │       │
        │  └──────────────┘  └──────────────┘  └──────────────┘       │
        │                                                               │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
        │  │Postgres      │  │Postgres      │  │Postgres      │       │
        │  │Messaging     │  │Notification  │  │Trust (5446)  │       │
        │  │  (5444)      │  │   (5445)     │  │              │       │
        │  │ - messaging  │  │ - notif      │  │ - trust      │       │
        │  └──────────────┘  └──────────────┘  └──────────────┘       │
        │                                                               │
        │  ┌──────────────┐  ┌──────────────┐                         │
        │  │Postgres      │  │    Redis     │                         │
        │  │Analytics(5447)│  │   (6379)     │                         │
        │  │ - analytics   │  │ - JWT Cache  │                         │
        │  │   schema      │  │ - Search     │                         │
        │  │               │  │   Cache      │                         │
        │  │               │  │ - Lua: singleflight, LFU/LRU, rate limit│
        │  └──────────────┘  └──────────────┘                         │
        │                                                               │
        │  ┌──────────────┐                                           │
        │  │    Kafka     │                                           │
        │  │ PLAINTEXT:9092│                                          │
        │  │   SSL:9093   │                                           │
        │  │ - Messaging  │                                           │
        │  │ - Events     │                                           │
        │  │ - Forum Posts│                                           │
        │  │ - Group Chat │                                           │
        │  │ - Strict TLS │                                           │
        │  └──────────────┘                                           │
        └───────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    Observability Stack (Kubernetes)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Prometheus  │  │   Grafana    │  │    Jaeger    │  │OTel Collector│  │
│  │  (Metrics)   │  │(Visualization)│  │  (Tracing)   │  │  (OTLP)      │  │
│  │              │  │              │  │              │  │              │  │
│  │ - Scrapes    │  │ - Dashboards │  │ - Distributed│  │ - Receives   │  │
│  │   /metrics   │  │ - Alerts     │  │   Traces     │  │   traces/    │  │
│  │ - 30d        │  │ - Queries    │  │ - Query UI   │  │   metrics    │  │
│  │   retention  │  │              │  │              │  │ - Exports to │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │   Jaeger/    │  │
│                                                          │   New Relic  │  │
│  ┌──────────────┐  ┌──────────────┐                    └──────────────┘  │
│  │   Linkerd    │  │ ServiceMesh  │                                       │
│  │  (Optional)  │  │   Metrics    │                                       │
│  │              │  │              │                                       │
│  │ - mTLS       │  │ - Topology   │                                       │
│  │ - Traffic    │  │ - Traffic    │                                       │
│  │   Management │  │   Flow       │                                       │
│  └──────────────┘  └──────────────┘                                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│              Infrastructure as Code (IAC) Layer                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Terraform                                    │  │
│  │  - Kubernetes Infrastructure Provisioning                            │  │
│  │  - Declarative Configuration (main.tf, variables.tf, outputs.tf)   │  │
│  │  - Namespace Management                                              │  │
│  │  - ConfigMap Creation                                                │  │
│  │  - Version Pinning (.terraform-version: 1.6.0)                     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Ansible                                       │  │
│  │  - Configuration Management                                           │  │
│  │  - Service Deployment (deploy-services.yml)                         │  │
│  │  - Safe Defaults (skip_cert_management, skip_caddy_config)          │  │
│  │  - Kubernetes Collections (kubernetes.core, community.kubernetes)   │  │
│  │  - Inventory Management (inventory/hosts.yml)                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Automation & Verification                          │  │
│  │  - test-iac-setup.sh: Comprehensive setup verification               │  │
│  │  - Makefile: Convenient IAC commands (terraform-*, ansible-*)        │  │
│  │  - Dry-run Support: terraform plan, ansible-playbook --check         │  │
│  │  - Auto-setup: Creates missing files automatically                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Cluster topology: Colima k3s primary, k3d supported

Preflight and all suites run on **Colima + k3s** by default. Colima is started with **`--network-address`** (bridged networking) so the MetalLB LoadBalancer IP is directly reachable from the host for HTTP/3 (QUIC). API is at **127.0.0.1:6443** via tunnel. **k3d** remains supported with `REQUIRE_COLIMA=0` for CI or lighter local runs.

```
                    Developer host
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
   ┌─────────────┐   ┌───────────┐    ┌─────────────┐
   │  Colima     │   │  k3d      │    │  Data       │
   │  k3s        │   │  2-node   │    │  (Docker    │
   │  (primary)  │   │ (optional)│    │   Compose)  │
   │             │   │           │    │  Postgres,  │
   │ --network-  │   │ Preflight │    │  Redis,     │
   │ address     │   │ when      │    │  Kafka      │
   │ MetalLB L2  │   │ REQUIRE_  │    │  7 DBs      │
   │ LB IP       │   │ COLIMA=0  │    │             │
   └─────────────┘   └───────────┘    └─────────────┘
        ▲                  ▲
        │                  │
   REQUIRE_COLIMA=1    REQUIRE_COLIMA=0
   (default)           (k3d path)
```

**Colima bring-back:** If Colima is stopped, use `./scripts/colima-start-and-ready.sh` (start only, with `--network-address`) or `./scripts/colima-teardown-and-start.sh` (full reset). See Runbook item 80.

**Usage:** Run preflight on Colima: `./scripts/run-preflight-scale-and-all-suites.sh` (default). With MetalLB enabled (`METALLB_ENABLED=1`), HTTP/2 and HTTP/3 use the **LB IP**; a one-time host route may be needed so the host can reach the LB IP for HTTP/3 (Runbook item 68). For k3d: `REQUIRE_COLIMA=0 METALLB_ENABLED=1 ./scripts/run-preflight-scale-and-all-suites.sh`. See `README.md`, `Runbook.md` (items 65, 68, 80), and `docs/adr/011-colima-k3s-primary-again.md`.

## Design Decisions

### Why Caddy Over Nginx/Traefik?

**Decision**: Use Caddy as the edge reverse proxy for HTTP/3, web, and REST API traffic instead of Nginx or Traefik.

**Rationale**:
1. **Native HTTP/3 (QUIC) Support**: Caddy has first-class HTTP/3 support without complex configuration
2. **Automatic TLS**: Built-in Let's Encrypt integration (though we use mkcert for local dev)
3. **Admin API**: Critical for zero-downtime CA rotation via `localhost:2019`
4. **Simpler Configuration**: Caddyfile syntax is more readable than Nginx configs
5. **Performance**: Competitive with Nginx for our use case
6. **Web & REST Focus**: Excels at HTTP/3, web app serving, and REST API routing

**Trade-offs**:
- Less mature ecosystem than Nginx
- Smaller community, but active development
- Admin API security considerations (bound to localhost only)
- **gRPC Limitations**: Caddy generates HTTP responses for gRPC requests, making it incompatible with grpc-js (see Issue #17 in docs/Runbook.md)

### Why Envoy for gRPC?

**Decision**: Use Envoy as a dedicated gRPC proxy instead of routing gRPC through Caddy.

**Rationale**:
1. **First-Class gRPC Support**: Envoy has native gRPC awareness and never routes gRPC through HTTP handlers
2. **Proven Functionality**: Envoy test passed immediately - same Node.js server works with Envoy, fails with Caddy
3. **Trailer Preservation**: Envoy correctly handles gRPC trailers
4. **Error Handling**: Envoy forbids HTTP error pages on gRPC streams
5. **HEADERS/DATA Ordering**: Envoy enforces correct gRPC frame ordering
6. **Industry Standard**: Many production systems use Envoy for gRPC, Caddy for HTTP/3
7. **Clean Separation**: Each proxy does what it's best at

**Architecture**:
- **Envoy**: Handles all gRPC traffic (port 10000)
- **Caddy**: Handles HTTP/3, web app, and REST API traffic (port 30443)
- **Clean Separation**: No mixing of concerns, each proxy optimized for its use case

**Trade-offs**:
- Two proxies to manage (more operational complexity)
- Two configs to maintain (Caddyfile + Envoy YAML)
- Additional resource usage (two proxy processes)
- **Mitigation**: Clear documentation, automation scripts, unified monitoring

**Investigation**: See `docs/Runbook.md` Issue #17 and `test-results/CADDY_ENVOY_DECISION.md` for complete investigation, proof, and decision rationale.

### Why 8 Separate PostgreSQL Instances?

**Decision**: Use 8 dedicated PostgreSQL instances instead of a single database with multiple schemas.

**Rationale**:
1. **Service Isolation**: Complete data isolation prevents cross-service data conflicts
2. **Independent Scaling**: Each database can be scaled independently based on service load
3. **Backup Strategy**: Independent backup/restore per service
4. **Connection Pooling**: Service-specific connection pools prevent resource contention
5. **Schema Evolution**: Services can evolve schemas without affecting others
6. **Multi-tenancy**: Clear boundaries for future multi-tenant support

**Trade-offs**:
- Higher resource usage (7 instances vs 1)
- More complex connection management
- Cross-service queries require dual-DB connections (auction-monitor, analytics-service)

**Implementation**: Services connect via Kubernetes Service names (e.g., `postgres-auth-external.off-campus-housing-tracker.svc.cluster.local:5441`) which route through Kubernetes Endpoints to Docker Compose postgres containers at `host.docker.internal:PORT`. All 8 housing instances have corresponding Kubernetes Services and Endpoints. Ports: 5441 auth, 5442 listings, 5443 bookings, 5444 messaging, 5445 notification, 5446 trust, 5447 analytics, 5448 media. **Restore and schema:** Deterministic restore via `scripts/restore-external-postgres-from-backup.sh` (optional hook in `bring-up-external-infra.sh` with `RESTORE_BACKUP_DIR`); schema inspection and expected-DB assertion via `scripts/inspect-external-db-schemas.sh`. See *Database Redundancy & Disaster Recovery* and `docs/RUNBOOK_EXTERNAL_POSTGRES_RECOVERY.md`.

### Strict TLS/mTLS and Preflight (Single Source of Truth)

**Decision**: All services that are tested and need to exist use strict TLS and mTLS. A single shared script (`ensure-strict-tls-mtls-preflight.sh`) validates and provisions `service-tls` + `dev-root-ca`; when the secret is created or updated, gRPC/TLS workloads are restarted so pods pick up the new CA and certs.

**Rationale**:
1. **Auth 503 / "self-signed certificate in certificate chain"**: API Gateway and other clients read CA/certs at process start. If `service-tls` is updated later (e.g. by reissue or OpenSSL provision), existing pods keep using the old CA in memory; verification then fails. Restarting deployments that mount `service-tls` after any update fixes this.
2. **Single source of truth**: One script (validate → try repo certs → provision with OpenSSL → restart if updated) is used by both the preflight pipeline and the test-suites runner, so we never run suites with invalid or stale certs.
3. **Preflight before suites**: `run-preflight-scale-and-all-suites.sh` runs the strict TLS preflight in step 5 and fails fast if the chain cannot be established; `run-all-test-suites.sh` runs the same script unless `SKIP_TLS_PREFLIGHT=1` (set when invoked from the preflight pipeline).

**Implementation**:
- **Script**: `scripts/ensure-strict-tls-mtls-preflight.sh` — validates full chain (CA + leaf + key), provisions from repo or OpenSSL, restarts api-gateway, auth-service, social-service, listings-service, shopping-service, auction-monitor, python-ai-service, analytics-service when `service-tls` is updated.
- **Preflight pipeline**: Step 5 runs the script then `ensure-all-services-tls.sh` (deploy manifest check). Step 7 runs `run-all-test-suites.sh` with `SKIP_TLS_PREFLIGHT=1`.
- **Standalone**: `./scripts/run-all-test-suites.sh` runs the script as cert preflight so standalone runs also get valid certs.

**Trade-offs**:
- Restarting 8 deployments after cert update adds ~30–90s to preflight when the secret is replaced; acceptable for correctness and to avoid flaky auth/503.

**References**: Runbook items 24–25; README Testing section; COMMIT_MESSAGE.txt (Strict TLS/mTLS preflight).

### Platform-Wide Intelligence (Analytics Engine → Python AI)

**Decision**: Analytics engine piped into Python AI for per-service AI-powered insights.

**Use Cases**:
- **Auction Monitor**: `AuctionHeat` — read "heat" of auction (bidding activity, sentiment, urgency)
- **Shopping/Listings**: `SellerBuyerInsight` — seller and buyer intelligence (pricing, demand, negotiation)
- **Social**: `SocialNegotiationInsight` — negotiation, planning, psychology (read psychology, help plan)

**Proto**: `proto/python-ai.proto` — AuctionHeat, SellerBuyerInsight, SocialNegotiationInsight RPCs. Stub implementations in `services/python-ai-service/app/grpc_server.py`. Full pipeline from analytics DB / Kafka is future work.

**Test Suite**: Protocol-aware (HTTP/2, HTTP/3, strict TLS/mTLS); packet capture (tcpdump/tshark) to prove wire-level traffic.

**Doc**: `PLATFORM-AI-ENGINE.md`

### Social Service Roles (owner, admin, moderator, member)

**Decision**: Group members have role hierarchy: owner > admin > moderator > member.

**Implementation**:
- **Owner**: Creator of group (was "admin"); highest privilege
- **Admin**: Promoted by owner; can add/remove members, delete group
- **Moderator**: Can moderate; cannot delete group or change owner
- **Member**: Standard participant

**DB**: `messages.group_members` CHECK (role IN ('owner', 'admin', 'moderator', 'member')). Migration: `infra/db/04-social-schema-roles-migration.sql`.

### Why gRPC Over REST for Inter-Service Communication?

**Decision**: Use gRPC for all inter-service communication instead of REST.

**Rationale**:
1. **Type Safety**: Protocol buffers provide compile-time type checking
2. **Performance**: Binary protocol is more efficient than JSON
3. **Streaming**: Native support for request/response streaming
4. **Code Generation**: Auto-generated client/server code reduces boilerplate
5. **HTTP/2 Multiplexing**: Single connection handles multiple concurrent requests
6. **Service Discovery**: Built-in with Kubernetes service names

**Implementation**:
- All services expose gRPC servers on dedicated ports (50051-50060)
- API Gateway proxies HTTP requests to gRPC backend services
- **Envoy routes all gRPC traffic** with first-class gRPC support (port 10000)
- TLS transport: All gRPC traffic uses HTTP/2 with TLS

**Trade-offs**:
- Less human-readable than JSON (requires tooling to inspect)
- Browser support requires gRPC-Web proxy
- Learning curve for developers unfamiliar with protocol buffers

### Why Kubernetes Over Docker Compose?

**Decision**: Migrate from Docker Compose to Kubernetes for local dev (see below: Colima + k3s primary; k3d optional).

**Rationale**:
1. **Production Parity**: Local dev environment matches production
2. **Service Discovery**: Native Kubernetes service discovery
3. **Resource Management**: CPU/memory limits and requests
4. **Rolling Updates**: Zero-downtime deployments with RollingUpdate strategy
5. **Observability**: Native integration with Prometheus, Grafana, Jaeger
6. **Scalability**: Easy horizontal scaling with replicas
7. **Kustomize**: Base/overlay pattern for environment-specific configs

**Trade-offs**:
- More complex setup than Docker Compose
- Higher resource requirements
- Steeper learning curve
- Databases still run in Docker Compose (stability and easier management)

### Why Colima + k3s

**Decision**: Use **Colima with k3s** as the primary local Kubernetes cluster, with **MetalLB** for the LoadBalancer (real L2, HTTP/2 and HTTP/3 to the LB IP). **k3d** remains supported with `REQUIRE_COLIMA=0` for CI or lighter local runs. Kind is not used.

**Rationale (why Colima + k3s)**:
1. **Docker Desktop limitations**: Docker Desktop’s embedded Linux VM and storage layer became a single point of failure under sustained load (many containers, 8 Postgres instances, Kafka, Redis, plus K8s control plane and workloads). API server timeouts, TLS handshake timeouts, and “cluster unreachable” were common when Kind ran on top of Docker Desktop.
2. **Storage/metadata wedge at ~256 GB**: At large Docker disk usage (e.g. ~256 GB or when metadata/overlay grew unbounded), Docker Desktop’s VM could **wedge** — daemon unresponsive, build and run operations hanging, host disk pressure. This made Kind-based dev and long-running test suites (preflight + 8 suites + pgbench) unreliable and at times impossible without a full Docker reset.
3. **Colima + k3s**: Colima provisions a Lima VM with containerd and optional k3s. k3s is a single-binary Kubernetes distribution with a smaller footprint than full K8s. Running **k3s inside Colima** (instead of Kind on Docker Desktop) reduces reliance on Docker Desktop’s VM and storage; API server is at 127.0.0.1:6443 and preflight scripts target this explicitly. Secret updates and kubectl from the host can require `colima ssh` when the host cannot reach 127.0.0.1:6443 (e.g. network or firewall); Runbook documents this.
4. **Hygiene and reproducibility**: Preflight pipeline (`run-preflight-scale-and-all-suites.sh`) **requires** Colima + k3s by default (`REQUIRE_COLIMA=1`). This avoids accidental runs against a stale or wrong cluster and aligns everyone on one supported path.

**Trade-offs**:
- k3d is supported with `REQUIRE_COLIMA=0` for CI or lighter runs; Kind is not used.
- Colima/k3s on macOS may still hit resource limits (CPU/memory) on a single node; scaling and cleanup (trim completed pods, aggressive ReplicaSet cleanup) are part of preflight to keep the cluster responsive.
- NodePort UDP for HTTP/3 (QUIC) can still be environment-dependent; in-cluster k6 and curl-based HTTP/3 tests remain the reliable way to prove QUIC.

**Bring-back:** Start Colima with `--network-address` (bridged) so the MetalLB LB IP is reachable. Use `./scripts/colima-start-and-ready.sh` (start only) or `./scripts/colima-teardown-and-start.sh` (full reset). See Runbook item 80.

**References**: Runbook (items 65, 68, 78, 80); README/ENGINEERING (preflight); docs/adr/011-colima-k3s-primary-again.md.

### Why Zero-Downtime CA Rotation?

**Decision**: Implement zero-downtime certificate authority rotation.

**Rationale**:
1. **Production Requirement**: Certificate rotation shouldn't cause service interruption
2. **Security**: Regular CA rotation is a security best practice
3. **Compliance**: Some industries require regular certificate rotation
4. **User Experience**: No downtime during certificate updates

**Implementation**:
1. **Caddy Admin API**: Use `localhost:2019` to reload configuration without pod restart
2. **Continuous Health Checks**: Test scripts run continuous requests during rotation
3. **Kubernetes Secrets**: New certificates mounted via secrets
4. **Fallback Strategy**: Pod restart if admin API fails

**Results**:
- ✅ **100% success rate** (validated with k6 distributed load testing)
- ✅ **1-2 second rotation time** (consistently fast, 8-10x faster than previous 16-17s)
- ✅ **Maximum proven throughput**: **~397 req/s** (71,447 requests in 180s) with **0% failures** and **0.76% drops**
- ✅ **Optimal k6 configuration**: H2=250 req/s (max 160 VUs), H3=150 req/s (max 100 VUs) - **production-ready**
- ✅ **Breaking point identified**: 260/160 configuration shows 0.08% failures (violates zero-downtime requirement)
- ✅ **Zero downtime achieved** with k6 distributed load testing under extreme production load
- ✅ **k6 optimization**: Constant-arrival-rate executor with connection reuse achieves optimal performance
- ✅ **Performance progression**: Tested configurations from 100/50 to 250/150, all maintaining 0% failures

**Trade-offs**:
- Admin API must be accessible (port-forward during rotation)
- Certificate file updates may require pod restart (Caddy caches in memory)
- Multi-node cluster recommended for true zero-downtime with pod restarts

## Test Suite: Preflight and Control Plane

The full test pipeline is structured as **preflight** followed by **eight suites**, with DB & cache verification after each suite and a comprehensive verification at the end. Optional k6 load and pgbench sweeps (e.g. `RUN_FULL_LOAD=1`) provide total platform coverage. This section explains why we run preflight, how suites are ordered, and how to run everything (including strict TLS for k6 and HTTP/1.1 vs HTTP/2 vs HTTP/3).

### Why Preflight First?
- **Kubeconfig**: Colima (or Kind, if still in use) kubeconfig may point at wrong host/port or stale API server. `preflight-fix-kubeconfig.sh` ensures `127.0.0.1:6443` (or Colima API) is reachable and fixes `KUBECONFIG` so `kubectl` works from the host.
- **API server readiness**: Under load or after restarts, the Kubernetes API server can be temporarily unreachable (TLS handshake timeout, context deadline exceeded). `ensure-api-server-ready.sh` retries until the API server responds so suites do not fail with spurious "cluster unreachable" errors.
- **Rationale**: Running suites without preflight leads to misleading failures (e.g. "rotation failed" when the real cause was API server timeout). Preflight is skipped when `SKIP_PREFLIGHT=1` (e.g. when called from `run-preflight-scale-and-all-suites.sh` after preflight has already run).

### Suite Order and Completion
- **Order**: 1) auth (test-auth-service.sh), 2) baseline (test-microservices-http2-http3.sh), 3) enhanced (test-microservices-http2-http3-enhanced.sh), 4) adversarial (enhanced-adversarial-tests.sh), 5) rotation (rotation-suite.sh), 6) standalone-capture (test-packet-capture-standalone.sh), 7) tls-mtls (test-tls-mtls-comprehensive.sh), 8) messaging (test-messaging-service-comprehensive.sh; `test-social-service-comprehensive.sh` is a deprecated wrapper). Each suite is tee'd to `$SUITE_LOG_DIR/<suite>.log`; verification to `$SUITE_LOG_DIR/<suite>-verification.log`.
- **Completion**: The runner prints "=== All Test Suites Complete ===" after all eight suites finish. Only suites that exited non-zero are reported in the error summary. There is no artificial timeout; run with `2>&1 | tee /tmp/full-run-$(date +%s).log` for live output and saved log. If a suite appears to hang, see docs/Runbook.md for packet-capture and gRPC/Envoy NodePort issues.

### How to run (command center)

- **Full pipeline:** `./scripts/run-preflight-scale-and-all-suites.sh` (preflight + scale + reissue + all 8 suites).
- **Suites only:** `./scripts/run-all-test-suites.sh 2>&1 | tee /tmp/full-run-$(date +%s).log` (assumes cluster and certs ready; runs strict TLS preflight unless `SKIP_TLS_PREFLIGHT=1`).
- **Total platform coverage:** `RUN_FULL_LOAD=1 ./scripts/run-preflight-scale-and-all-suites.sh` — enables `RUN_K6=1` and `RUN_PGBENCH=1` (default pgbench mode: deep) for full load and DB sweep validation.

**Why 8+ suites and a command center:** We run 8 core suites plus optional k6 and pgbench (15+ scripts when counting limit-finding, service-specific k6, and DB verification). The platform spans multiple protocols (HTTP/1.1, HTTP/2, HTTP/3, gRPC), strict TLS/mTLS, zero-downtime rotation, and 8 databases. A single entry point (`run-all-test-suites.sh` or `run-preflight-scale-and-all-suites.sh`) orchestrates order, preflight, and DB/cache verification. See `scripts/load/LOAD_TESTS_CATALOG.md` for the full catalog.

**Strict TLS for k6:** All k6 runs use strict TLS (no `-k`). The runner sets `SSL_CERT_FILE` to the dev-root CA (from K8s secret or `certs/dev-root.pem`) so `off-campus-housing.local` x509 verification succeeds. If you see `x509: certificate is not trusted`, set `K6_CA_CERT=/path/to/dev-root.pem` or run after preflight.

**HTTP/1.1, HTTP/2, and HTTP/3 (xk6-http3 and HOLB):**
- **HTTP/2:** Standard k6 uses HTTP/2 by default over TLS; we use it for baseline and limit tests.
- **HTTP/3:** k6 does not ship HTTP/3; we use **xk6-http3** (custom binary via `scripts/build-k6-http3.sh`, e.g. `.k6-build/bin/k6-http3`) for HTTP/3 (QUIC) load tests. Curl-based tests (`scripts/test-microservices-http2-http3.sh`) also verify HTTP/3 with strict TLS.
- **HTTP/1.1:** Supported for legacy clients; we test that the edge accepts HTTP/1.1 and returns 200 where applicable.
- **Head-of-line blocking (HOLB):** HTTP/2 multiplexes streams over one TCP connection — a single lost packet can block all streams. HTTP/3 (QUIC) uses independent streams over UDP. We run **both** HTTP/2 and HTTP/3 tests to demonstrate latency/throughput differences and to prove HOLB is real (e.g. `k6-limit-test-comprehensive.js` H2 vs H3, or `scripts/compare-http2-http3.sh`).

### Database Verification (8 housing DBs: 5441–5448)
- All **8 PostgreSQL instances** are checked: 5441 auth, 5442 listings, 5443 bookings, 5444 messaging, 5445 notification, 5446 trust, 5447 analytics, 5448 media. Scripts: `verify-db-cache-quick.sh` (after each suite), `verify-db-and-cache-comprehensive.sh` (at end). Full port range 5441–5448 is used for correctness.

### Strict TLS and Packet Capture
- **Strict TLS**: All gRPC and HTTP tests use CA verification (no insecure skip). `test-tls-mtls-comprehensive.sh` validates certificate chain and mTLS configuration; gRPC via Envoy must use strict TLS where applicable.
- **Packet capture**: HTTP/2 (TCP 443) and HTTP/3/QUIC (UDP 443) are verified at wire level via tcpdump/tshark on Caddy/Envoy pods. **All HTTP/3 tests use the same pattern as rotation-suite**: (1) drain (5–15s before stopping tcpdump so in-flight QUIC packets are captured), (2) copy pcaps from pods to host (`CAPTURE_COPY_DIR`), (3) tshark verification when available (`scripts/lib/protocol-verification.sh`). Wire summary (TCP 443 / UDP 443) proves traffic when TLS prevents http2 decode. Set `CAPTURE_DRAIN_SECONDS=5` and `CAPTURE_COPY_DIR` before `stop_and_analyze_captures`; see `scripts/lib/packet-capture.sh` and docs/Runbook.md #44. Empty pcaps or "No QUIC packets detected" indicate capture or traffic routing issues; see docs/Runbook.md and TEST_SUITE_REALITY_AND_K6_TUNING.md.
- **Profiling / live telemetry**: Debug tools include tshark, tcpdump, netstat, **perf**, htop, strace (Runbook "Debug Tools"). For future optimization, live telemetry (Prometheus/Grafana, OpenTelemetry) and on-demand profiling (perf, htop) at end of suites can show how the system is performing.

### Preflight pipeline: run-preflight-scale-and-all-suites.sh (in depth)

The **single entry point** for “cluster ready → certs valid → all suites (and optional k6/pgbench)” is `scripts/run-preflight-scale-and-all-suites.sh`. It is the **command center** for hygiene and reproducibility: one run fixes kubeconfig, reissues CA/leaf, ensures strict TLS/mTLS, brings up dependencies (Postgres, Kafka, social migrations), scales to baseline, and then runs all eight test suites (and optionally pgbench and k6). Why each step exists:

| Step | What it does | Why we need it |
|------|----------------|----------------|
| **0** | Kill stale pipeline/test processes (optional, `KILL_STALE_FIRST=1`) | Avoids multiple runners and stuck jobs competing for API server and ports. |
| **1** | Require Colima + k3s context (127.0.0.1:6443); trim completed pods | Ensures we target the correct cluster; trimming reduces API server load and etcd bloat. |
| **2** | Preflight kubeconfig (`preflight-fix-kubeconfig.sh`) | Kubeconfig may point at wrong host/port or stale API server; fixes `KUBECONFIG` so `kubectl` works from host. |
| **3** | Ensure API server ready (`ensure-api-server-ready.sh`) | Under load or after restarts, the API server can be unreachable; retries until it responds so suites don’t fail with “cluster unreachable”. |
| **3a** | Reissue CA + leaf (dev-root-ca, record-local-tls); `KAFKA_SSL=1` | Aligns CA and Caddy certs so strict TLS works (no curl 60); Kafka SSL uses same CA. |
| **3b–3f** | Kafka SSL secret, Docker Kafka/Postgres up, migrations, app-config/kafka-external apply, remove in-cluster Kafka/ZK/Postgres, patch kafka-external, restart Kafka-consuming services | All 8 Postgres (5441–5448) and Kafka (strict TLS :29093) must be up and externalized. |
| **4** | Scale to baseline (service 1, exporters 1, Envoy 1, Caddy 2) | Consistent baseline so suites don’t hit scaled-down or missing deployments. |
| **4c–4d** | Re-ensure API server; verify Caddy strict TLS (no curl 60) | Confirms cluster and edge are usable after reissue and scale. |
| **5** | Strict TLS/mTLS preflight (`ensure-strict-tls-mtls-preflight.sh`); sync CA to `certs/dev-root.pem` | Single source of truth for service-tls + dev-root-ca; restarts gRPC/TLS workloads so pods pick up CA/certs; k6 uses repo CA. |
| **6** | Pod health, DB, Redis; aggressive cleanup of rogue ReplicaSets; wait for all services ready; optional pgbench (6c) | No suite runs until pods and 8 DBs (5441–5448) are healthy; cleanup avoids stuck ReplicaSets; pgbench runs when `RUN_PGBENCH=1` (default deep); set `RUN_PGBENCH=0` to skip. |
| **7** | Run all test suites (`run-all-test-suites.sh` with SKIP_PREFLIGHT/SKIP_TLS_PREFLIGHT); optional k6 | Eight suites in fixed order; RUN_FULL_LOAD=1 adds k6 + pgbench for total platform coverage. |
| **7c** | In-cluster k6 (transport isolation) | When `RUN_K6=1` and `RUN_K6_IN_CLUSTER=1` (default), runs `scripts/run-k6-in-cluster.sh` (ClusterIP-only, no host/MetalLB); duration via `K6_IN_CLUSTER_DURATION` (default 30s). Proves HTTP/2 and HTTP/3 under load inside the cluster. |

**Env vars:** `RUN_SUITES=0` skips suites; `RUN_FULL_LOAD=1` sets `RUN_K6=1` and `RUN_PGBENCH=1` (PGBENCH_MODE=deep); `REQUIRE_COLIMA=1` (default) fails if context is not Colima. Use `./scripts/ensure-ready-for-preflight.sh` before preflight to verify API, DBs, and Kafka.

### Why eight suites (and what each one is for)

We run **eight** suites because the platform has **multiple protocols**, **strict TLS/mTLS**, **zero-downtime rotation**, **wire-level proof**, and **eight housing databases (5441–5448)**; a single “e2e” test cannot cover failure modes, rotation, and protocol behavior. Each suite has a distinct role:

| # | Suite | Script | Why we need it |
|---|--------|--------|------------------|
| 1 | **Auth** | test-auth-service.sh | Register, login, MFA, passkeys — auth is the gatekeeper for all services; must pass before any other suite. |
| 2 | **Baseline** | test-microservices-http2-http3.sh | Smoke: HTTP/2, HTTP/3, gRPC health and business logic (all 10 services), packet capture. Proves edge and Envoy and DB connectivity. |
| 3 | **Enhanced** | test-microservices-http2-http3-enhanced.sh | Deeper HTTP/2 vs HTTP/3 and packet capture; adversarial-style checks. |
| 4 | **Adversarial** | enhanced-adversarial-tests.sh | Malformed requests, protocol downgrade, invalid certs — proves we don’t break under abuse. |
| 5 | **Rotation** | rotation-suite.sh | CA/leaf rotation under k6 load; zero-downtime and wire-level capture. Proves rotation and Caddy reload. |
| 6 | **Standalone capture** | test-packet-capture-standalone.sh | Packet capture in isolation (drain → stop → copy → tshark); same pattern as rotation for QUIC verification. |
| 7 | **TLS/mTLS** | test-tls-mtls-comprehensive.sh | Full chain validation, mTLS, gRPC strict TLS; proves cert chain and client cert handling. |
| 8 | **Messaging** | test-messaging-service-comprehensive.sh | Forum, messages, archive/recall/kick/ban, groups; `test-social-service-comprehensive.sh` execs this script. |

**Why so many tests:** One “e2e” cannot (1) prove HTTP/2 vs HTTP/3 at the wire, (2) prove zero-downtime rotation under load, (3) validate strict TLS/mTLS and cert chain, (4) stress auth and social and DBs in isolation, (5) run pgbench across 8 housing DBs. Splitting into eight suites gives clear failure scope (e.g. “rotation failed” vs “social 501”) and allows optional k6/pgbench without re-running auth/baseline every time. DB and cache verification (8 DBs, 5441–5448) after each suite keeps the platform honest.

### xk6-http3: what it is and why we use it

- **What:** Custom k6 binary built with **xk6** and the **xk6-http3** extension (quic-go). Built via `scripts/build-k6-http3.sh`; binary at `.k6-build/bin/k6-http3`. k6 does not ship HTTP/3; this extension adds QUIC support so we can run load tests over HTTP/3.
- **Why:** We need to **prove** that the edge and tests use HTTP/3 (QUIC) under load, not just HTTP/2. Limit tests (e.g. `k6-limit-test-comprehensive.js`) and rotation chaos use H2 and H3; xk6-http3 is the only way to drive real QUIC traffic from k6.
- **Limitation:** When k6 runs **outside** the cluster (e.g. on the host), NodePort UDP routing for QUIC (port 30443) can fail or time out — so external k6-http3 may not reach the edge over HTTP/3.
- **Workaround:** (1) **Curl-based HTTP/3** in `scripts/test-microservices-http2-http3.sh` (runs inside cluster/node network namespace where QUIC works). (2) **In-cluster k6 jobs** (e.g. rotation-suite) that use ClusterIP and run inside the cluster so QUIC is used. (3) **Packet capture** (tcpdump/tshark) to verify UDP 443 (QUIC) vs TCP 443 (HTTP/2) so we have wire-level proof regardless of where k6 runs.
- **Documentation:** `test-results/K6_HTTP3_TOOLCHAIN_STATUS_12-22_tom.md`, `scripts/load/LOAD_TESTS_CATALOG.md`.

## Technology Stack

### Edge & Routing
- **Caddy**: HTTP/2, HTTP/3 (QUIC), TLS termination for web and REST API traffic
- **Envoy**: First-class gRPC support for all gRPC traffic (port 10000)
- **ingress-nginx**: Kubernetes ingress controller
- **Nginx**: Static asset serving, micro-caching
- **HAProxy**: Keep-alive pools, load balancing

### Application Layer
- **Node.js 20+**: Runtime for all microservices
- **Express**: HTTP server framework
- **TypeScript**: Type-safe development
- **Next.js 14+**: React framework for web app
- **Python 3.11+**: FastAPI for AI service

### Data Layer
- **PostgreSQL 16**: 8 dedicated instances for service isolation
- **Redis 7**: JWT revocation cache, search result caching. **Cache layer (see architecture diagram)**: Redis is used by API Gateway (JWT revocation), records-service (search cache), auth-service (user lookup), listings-service (listing cache), social-service and auction-monitor (singleflight + rate limiting). **Lua scripts** in Redis provide singleflight (cache stampede prevention), LFU/LRU eviction (e.g. shopping-service), and token-bucket/sliding-window rate limiting. See README “Caching & Redis Lua Scripts” for script list and data flow.
- **Kafka**: Event streaming, real-time messaging. **Strict TLS enabled** with SSL listener on port 9093. SSL certificates stored in `kafka-ssl-secret`.

### Inter-Service Communication
- **gRPC**: Protocol buffer-based RPC
- **Protocol Buffers**: Schema definition and code generation
- **HTTP/2**: Transport for gRPC (h2c and TLS)

### Infrastructure
- **Kubernetes (Colima + k3s or k3d)**: Local development cluster (Colima + k3s primary; k3d with REQUIRE_COLIMA=0; see “Why Colima + k3s” above). API server at 127.0.0.1:6443; preflight accepts REQUIRE_COLIMA=0 for k3d (in-cluster Caddy verify) or Colima when REQUIRE_COLIMA=1.
- **Kustomize**: Configuration management
- **Terraform**: Infrastructure as Code
- **Ansible**: Configuration management and deployment

**Kubernetes base images (fix once and for all):** All app deployments in `infra/k8s/base` use `imagePullPolicy: IfNotPresent` (not `Never`). This avoids `ErrImageNeverPull` when images are provided by the k3d registry or loaded into nodes. On k3d, preflight patches `host.docker.internal` to the host gateway (on macOS, Docker Desktop uses `192.168.65.2`) so Redis and Postgres on the host are reachable from pods. Do not revert to `Never`.

### Observability
- **Prometheus**: Metrics collection
- **Grafana**: Visualization and dashboards
- **Jaeger**: Distributed tracing
- **OpenTelemetry**: Instrumentation standard

### Development Tools
- **Prisma**: ORM and database migrations
- **pnpm**: Package manager
- **Docker**: Containerization
- **mkcert**: Local certificate generation

### Technology stack: justification and trade-offs (senior-design review)

This section justifies the main technology choices as for a **senior design review**: what we chose, why it fits the problem, and what we gave up. The goal is to show that the stack is **deliberate**, not accidental, and that trade-offs are understood and documented.

| Area | Choice | Justification | Trade-offs |
|------|--------|----------------|------------|
| **Edge (HTTP/3 + REST)** | Caddy | First-class HTTP/3 (QUIC), automatic HTTPS, admin API for zero-downtime reload, simple Caddyfile. We need QUIC and web + REST in one place. | gRPC handling is poor (HTTP response for gRPC); we don’t use Caddy for gRPC. Smaller ecosystem than Nginx. |
| **gRPC** | Envoy | First-class gRPC (frame ordering, trailers, no HTTP handler interference). Same Node server works with Envoy, failed with Caddy. | Two proxies (Caddy + Envoy), two configs. Extra operational surface. |
| **Databases** | 8 dedicated Postgres | Service isolation, independent scaling and backup, clear schema boundaries. Aligns with microservice ownership. | More connections and ops; cross-service queries need dual-DB (auction-monitor, analytics). |
| **Cache** | Redis + Lua | Singleflight (stampede prevention), LFU/LRU (shopping), rate limiting (token bucket, sliding window). Atomic ops without thundering herd. | Lua is niche; onboarding requires reading scripts. Redis is single point of failure without Sentinel/Cluster. |
| **Messaging** | Kafka (strict TLS) | Event pipeline (forum, DMs, group chat); Python AI consumes from Kafka. SSL on 9093 with kafka-ssl-secret. | More moving parts; SSL cert and endpoint patching (e.g. kafka-external) required. |
| **Local K8s** | Colima + k3s (primary) or k3d | Colima: primary path; start with `--network-address`, API at 127.0.0.1:6443, MetalLB LB IP for HTTP/3. k3d: `REQUIRE_COLIMA=0` for CI or lighter runs. See ADR 011. | Kind/h3 not supported. Single-node limits; 2-node minimum for reissue/MetalLB (ADR 008). |
| **IAC** | Terraform + Ansible | Terraform for declarative infra (namespaces, ConfigMaps); Ansible for deploy and config (K8s collections). Dry-run and idempotency for safe ops. | Two tools to learn; Ansible playbooks skip cert/Caddy by default to avoid clobbering local state. |
| **Testing** | Preflight + 8 suites + k6 + pgbench | Multi-protocol (HTTP/2, HTTP/3, gRPC), strict TLS/mTLS, rotation, 8 housing DBs (5441–5448) — one “e2e” cannot cover failure modes and wire-level proof. Eight suites give clear scope; RUN_FULL_LOAD=1 adds load and DB sweep. | Many scripts and long runtimes; we accept complexity for reproducibility and debuggability. |
| **HTTP/3 load** | xk6-http3 + curl | k6 doesn’t ship HTTP/3; xk6-http3 (quic-go) adds QUIC for load tests. NodePort UDP can fail externally; curl-based and in-cluster k6 are workarounds. | External xk6-http3 may not reach QUIC; we rely on in-cluster and packet capture for proof. |

**Summary:** Every major choice (Caddy, Envoy, 8 Postgres housing DBs, Redis+Lua, Kafka, Colima+k3s, Terraform+Ansible, preflight+8 suites) is justified by a concrete need (QUIC, gRPC correctness, isolation, cache safety, event pipeline, cluster stability, reproducibility, test coverage). Trade-offs are documented so a reviewer can see that we did not choose “everything”; we chose a coherent set and accepted the costs.

**Architecture rationale (why this setup):** The overall design aims for **control-plane stability**, **service isolation**, and **reproducible testing** on a single developer machine. (1) **Colima + k3s** (primary) with `--network-address` gives real L2/MetalLB and API at 127.0.0.1:6443; k3d supported with `REQUIRE_COLIMA=0`. (2) **Eight dedicated Postgres** (5441–5448, housing: auth, listings, bookings, messaging, notification, trust, analytics, media) in Docker Compose with deterministic restore and schema inspection (see Database Redundancy & Disaster Recovery). (3) **Redis + Lua** for atomic singleflight, LFU/LRU, and rate limiting. (4) **Data plane outside the cluster** keeps heavy I/O off the control plane. (5) **MetalLB** provides LB IP for Caddy when enabled; one-time host route for HTTP/3 to LB IP on Colima (Runbook 68). (6) **Strict TLS and one CA** (dev-root-ca, reissue in preflight). (7) **Preflight + ensure scripts** (ensure-k8s-api, ensure-pgbench-dbs-ready, ensure-ready-for-preflight) bring API, DBs, and Kafka to a known-good state. See ADR 007, ADR 011, Runbook 50–51, 79–80.

## Data Flow Diagrams

### Authentication Flow

```
Client Request
    │
    ▼
Caddy (TLS Termination)
    │
    ▼
ingress-nginx
    │
    ▼
API Gateway (4020)
    │
    ├─► JWT Verification (Redis cache check)
    │
    ├─► Auth Service (gRPC:50051)
    │   │
    │   └─► Auth DB (5437) - auth schema
    │
    └─► Response with JWT
```

### Record Search Flow

```
Client Request: GET /api/records/search?q=...
    │
    ▼
Caddy → ingress-nginx → API Gateway
    │
    ├─► JWT Verification
    │
    └─► Envoy (gRPC Proxy:10000) → Records Service (gRPC:50051)
        │
        ├─► Redis Cache Check
        │   └─► Cache Hit → Return Results
        │
        └─► Cache Miss
            │
            ├─► Listings DB (5442) - listings schema
            │   └─► Search Query (trgm, knn, or percent)
            │
            └─► Cache Results → Return
```

### Real-Time Messaging Flow

```
Client: POST /api/social/messages
    │
    ▼
Caddy → ingress-nginx → API Gateway
    │
    └─► Envoy (gRPC Proxy:10000) → Social Service (gRPC:50056)
        │
        ├─► Messaging DB (5444) - messaging schema
        │   └─► Store Message
        │
        └─► Kafka Producer
            │
            └─► Kafka Topic: messages
                │
                └─► Kafka Consumer (Social Service)
                    │
                    └─► WebSocket/SSE → Client
```

### Auction Monitoring Flow

```
Auction Monitor Service (4008)
    │
    ├─► Read: Listings DB (5435) - listings.watchlist
    │   └─► Get Watched Items
    │
    ├─► Platform Adapters (eBay API, Discogs API, Scraping)
    │   ├─► Rate Limiting (Redis Lua scripts)
    │   ├─► Caching (Redis with singleflight pattern)
    │   └─► Browser Pool (Puppeteer for scraping)
    │
    ├─► Data Pipeline
    │   ├─► Normalization (platform-specific → unified schema)
    │   ├─► Validation (required fields, data types, business rules)
    │   ├─► Deduplication (exact match, URL match, fuzzy matching)
    │   └─► Confidence Scoring (completeness, source reliability, freshness)
    │
    └─► Write: Auction Monitor DB (5438)
        ├─► raw_listings (staging)
        ├─► normalized_listings (validated, high-confidence)
        └─► price_history (time-series)
```

## Service Communication Patterns

### gRPC Communication

All inter-service communication uses gRPC with protocol buffers:

1. **API Gateway → Backend Services**: HTTP request converted to gRPC call
2. **Service-to-Service**: Direct gRPC calls using service discovery
3. **Envoy gRPC Routing**: Envoy handles all gRPC traffic with first-class gRPC support (port 10000)
   - **Never routes through HTTP handlers**: Envoy has native gRPC awareness
   - **Trailer preservation**: Correctly handles gRPC trailers
   - **Error handling**: Forbids HTTP error pages on gRPC streams
   - **Proven functionality**: Same Node.js server works with Envoy, fails with Caddy

**Protocol Buffer Definitions**:
- `proto/auth.proto`: Authentication and user management
- `proto/records.proto`: Record collection CRUD operations
- `proto/listings.proto`: Marketplace and auction data
- `proto/social.proto`: Forum posts, comments, messaging
- `proto/analytics.proto`: Price snapshots and analytics
- `proto/shopping.proto`: Shopping cart and orders
- `proto/auction-monitor.proto`: Auction monitoring and price tracking
- `proto/python-ai.proto`: AI predictions and recommendations

### HTTP Endpoints

Services expose HTTP endpoints for:
- Health checks: `GET /healthz`
- Metrics: `GET /metrics` (Prometheus format)
- gRPC reflection: For tooling support (grpcurl)

### Caching Strategy

**Redis Caching**:
- **JWT Revocation**: Blacklist revoked tokens
- **Search Results**: Normalized search keys with user-specific invalidation
- **Rate Limiting**: Per-user rate limit counters

**Cache Invalidation**:
- Mutations trigger targeted cache invalidation
- User-specific cache keys prevent cross-user data leakage
- Lua scripts prevent cache stampedes (singleflight pattern)

## Infrastructure as Code & Disaster Recovery

### One-Command Bootstrap

**Purpose**: Instant platform deployment and disaster recovery.

**Bootstrap Script** (`scripts/bootstrap-platform.sh`):
- **Complete platform deployment** in a single command
- Orchestrates Terraform + Ansible + Docker + Kubernetes
- **Disaster recovery**: Instant cluster recreation
- **Idempotent**: Safe to run multiple times

**Features**:
- Prerequisites checking (Terraform, Ansible, kubectl, docker; Colima + k3s or optional Kind)
- Cluster creation/verification (Colima: `colima start --with-kubernetes`; or Kind if still used)
- Terraform initialization and application
- Ansible collection installation and service deployment
- Docker image building and loading
- Kubernetes resource deployment via Kustomize
- Health checks and status reporting

**Usage**:
```bash
# Full bootstrap
./scripts/bootstrap-platform.sh

# Preview changes (dry-run)
./scripts/bootstrap-platform.sh --dry-run

# Skip Docker builds
./scripts/bootstrap-platform.sh --skip-build

# Teardown (disaster recovery reset)
./scripts/bootstrap-platform.sh --destroy

# Custom configuration
./scripts/bootstrap-platform.sh --cluster my-cluster --env prod
```

**Disaster Recovery Workflow**:
1. **Cluster**: Colima bring-back (`./scripts/colima-start-and-ready.sh` or `./scripts/colima-teardown-and-start.sh`) or bootstrap destroy/recreate.
2. **Data plane**: `./scripts/bring-up-external-infra.sh` (optionally with `RESTORE_BACKUP_DIR=backups/all-8-<timestamp>` to restore Postgres from backup).
3. **Standalone restore**: If not using bring-up hook, run `./scripts/restore-external-postgres-from-backup.sh <backup_dir>` after infra is up.
4. **Verification**: `./scripts/inspect-external-db-schemas.sh`, then preflight or integration tests.

**Documentation**: See `docs/BOOTSTRAP.md`, `docs/RUNBOOK_EXTERNAL_POSTGRES_RECOVERY.md`, and Runbook items 79–80.

### Terraform

**Purpose**: Declarative Kubernetes infrastructure provisioning.

**Structure**:
- `main.tf`: Provider configuration and main resources
- `variables.tf`: Input variables (namespace, environment, kubeconfig)
- `outputs.tf`: Output values (namespace, kubeconfig path, service ports)
- `kubernetes.tf`: Kubernetes resources (namespaces, ConfigMaps)

**Disaster Recovery**:
- Infrastructure state stored in Terraform
- Enables instant infrastructure recreation
- Idempotent operations (safe to run multiple times)
- State management: Local by default, remote backend for production (S3, GCS, etc.)

**Usage**:
```bash
cd infra/terraform
terraform init
terraform plan    # Dry-run
terraform apply   # Apply changes
terraform destroy # Teardown (use bootstrap script instead)
```

### Ansible

**Purpose**: Configuration management and service deployment.

**Structure**:
- `ansible.cfg`: Ansible configuration
- `requirements.yml`: Kubernetes collections
- `inventory/hosts.yml`: Kubernetes host configuration
- `playbooks/deploy-services.yml`: Service deployment playbook

**Safety Features**:
- `skip_cert_management: true`: Doesn't touch certificates
- `skip_caddy_config: true`: Doesn't modify Caddy config
- Dry-run support: `ansible-playbook --check`
- **Idempotent**: Safe to run multiple times

**Disaster Recovery**:
- Idempotent playbooks enable consistent service deployment
- Kubernetes API-based (no state files required)
- Safe to re-run after infrastructure recreation

**Usage**:
```bash
cd infra/ansible
ansible-playbook playbooks/deploy-services.yml --check  # Dry-run
ansible-playbook playbooks/deploy-services.yml          # Deploy
```

### Database Redundancy & Disaster Recovery

**Current State**: Eight PostgreSQL instances (housing) run in Docker Compose (external to Kubernetes) on ports 5441–5448 (auth, listings, bookings, messaging, notification, trust, analytics, media). Pods reach them via `host.docker.internal`. Restore and schema inspection are deterministic and automated.

**External Postgres layout (8 housing DBs)**:
- **5441** auth, **5442** listings, **5443** bookings, **5444** messaging, **5445** notification, **5446** trust, **5447** analytics, **5448** media.
- **Schema inspection**: `scripts/inspect-external-db-schemas.sh` reports tables/schemas per port. Use `SKIP_EXPECTED_DB_CHECK=1` to bypass checks. Output: `docs/CURRENT_DB_SCHEMA_REPORT.md` (refresh with the same script).

**Deterministic restore**:
- **Script**: `scripts/restore-external-postgres-from-backup.sh` (or project-specific restore) — restores all 8 DBs from a backup directory (e.g. `backups/all-8-<timestamp>`). Requires `pg_restore`/`psql` 16.x; terminates active sessions before drop. Runs `ANALYZE` after each restore and prints a **snapshot fingerprint** (table counts). For CI/prod use an explicit snapshot path; `latest` is for local dev only (`RESTORE_ALLOW_LATEST=1` when calling the script with `latest`).
- **Bring-up hook**: `RESTORE_BACKUP_DIR=backups/all-8-<timestamp> ./scripts/bring-up-external-infra.sh` runs restore after infra is healthy. Use `RESTORE_BACKUP_DIR=latest` for latest backup when bring-up is used locally.
- **Runbook**: `docs/RUNBOOK_EXTERNAL_POSTGRES_RECOVERY.md` — preconditions, version guard, verification, password (PGPASSWORD / ~/.pgpass).

**Production Requirements** (future):
- **PostgreSQL**: Managed services (AWS RDS, Google Cloud SQL, Azure Database); automatic backups; read replicas; multi-AZ; connection pooling (e.g. PgBouncer).
- **Redis**: Managed Redis; replication; RDB/AOF; automatic failover.
- **Kafka**: Managed Kafka (AWS MSK, Confluent Cloud); replication; strict TLS on 9093; certs via Kubernetes secrets.

**Disaster Recovery Plan**:
1. **Infrastructure**: Bootstrap or Colima bring-back (`colima-start-and-ready.sh` / `colima-teardown-and-start.sh`).
2. **Data plane**: `./scripts/bring-up-external-infra.sh` (optionally with `RESTORE_BACKUP_DIR`).
3. **Restore**: If not done via bring-up, run `./scripts/restore-external-postgres-from-backup.sh <backup_dir>`.
4. **Verification**: `./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md`; run preflight/integration tests.

### Disaster recovery: shell script breakdown

Four scripts form the backup and bring-back flow for **Colima + k3s** and the 7-DB housing data plane. Run **backup** regularly or before major changes; run **bring-back** (steps 2–4) after cluster or host loss.

| Script | Purpose | How to run |
|--------|---------|------------|
| **`scripts/backup-all-dbs.sh`** | Hard backup of all 8 external Postgres instances (schema, indexes, data, tuning metadata). | `PGPASSWORD=postgres ./scripts/backup-all-dbs.sh`. Optional: `BACKUP_DIR=/path`, `PGHOST=127.0.0.1`. Output: `backups/all-8-YYYYMMDD-HHMMSS/` (or `BACKUP_DIR`). |
| **`scripts/setup-new-colima-cluster.sh`** | One-shot: create a new Colima + k3s cluster and install MetalLB (L2). Use after `colima delete` or when no Colima instance exists. | `./scripts/setup-new-colima-cluster.sh`. Set `METALLB_POOL=192.168.64.240-192.168.64.250` (or your subnet range). Env: `CPU`, `MEMORY`, `DISK`, `COLIMA_K3S_VERSION`. |
| **`scripts/bring-up-external-infra.sh`** | Bring up external stack: Zookeeper, Kafka (SSL), Redis, 8 Postgres (5441–5448). Uses Docker Compose; run before preflight or k8s so pods can reach `host.docker.internal:5441–5448`, 6379, 29093. | `./scripts/bring-up-external-infra.sh`. To restore DBs: `RESTORE_BACKUP_DIR=backups/all-8-YYYYMMDD-HHMMSS ./scripts/bring-up-external-infra.sh` or `RESTORE_BACKUP_DIR=latest`. Optional: `SKIP_KAFKA=1`, `SKIP_COMPOSE_UP=1`, `MAX_WAIT=180`. |
| **`scripts/inspect-external-db-schemas.sh`** | Inspect external Postgres DBs and write a schema report (tables, schemas per port). Default: 8 housing DBs (5441–5448). | `PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh [report-dir]`. Default report: `reports/schema-report-<timestamp>.md`. To refresh current schema doc: `PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md`. |

**Order for full bring-back (after loss)**:
1. **Backup** (before loss): `PGPASSWORD=postgres ./scripts/backup-all-dbs.sh`.
2. **Cluster**: `METALLB_POOL=<start>-<end> ./scripts/setup-new-colima-cluster.sh`.
3. **External infra + restore**: `RESTORE_BACKUP_DIR=backups/all-8-<newest-timestamp> ./scripts/bring-up-external-infra.sh`.
4. **Schema check**: `PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md`.

See **README.md** (Full disaster recovery protocol), **Runbook.md** (item 82), and **docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md**.

## Observability & Monitoring

### Complete Observability Stack

**Components**:
1. **Prometheus** - Metrics collection and alerting
2. **Grafana** - Visualization and dashboards
3. **Jaeger** - Distributed tracing
4. **OpenTelemetry Collector** - Unified observability data pipeline
5. **New Relic** (Optional) - Cloud observability platform
6. **Linkerd** (Optional) - Service mesh with advanced observability

**Installation**:
- **Automated**: `bash infra/k8s/scripts/install-observability.sh`
- **Via Bootstrap**: Included in `./scripts/bootstrap-platform.sh`
- **Helm Charts**: `prometheus-community/kube-prometheus-stack` for Prometheus + Grafana

### Metrics (Prometheus)

**Deployment**:
- **Helm Chart**: `prometheus-community/kube-prometheus-stack`
- **Storage**: 50Gi PVC with 30-day retention
- **Namespace**: `monitoring`
- **Configuration**: `infra/k8s/base/observability/prometheus-deploy.yaml`

**Collection**:
- **ServiceMonitors** (`infra/k8s/base/monitoring/servicemonitors.yaml`): Auto-discovery of service metrics
  - Targets: api-gateway, auth-service, records-service, listings-service, analytics-service, social-service, shopping-service, python-ai-service, auction-monitor, nginx, haproxy
- **PodMonitors** (`infra/k8s/base/observability/podmonitors.yaml`): Pod-level metrics collection
- **Scrape interval**: 15-30 seconds
- **Retention**: 30 days
- **AlertManager**: Integrated alerting with notification channels

**Key Metrics**:
- Request rate, latency, error rate per service
- gRPC call metrics (success/failure, latency)
- Database connection pool metrics
- Cache hit/miss rates
- HTTP/2 and HTTP/3 connection metrics
- Kubernetes cluster metrics (CPU, memory, network)

**Access**:
```bash
kubectl -n monitoring port-forward svc/monitoring-kube-prom-prometheus 9090:9090
# http://localhost:9090
```

### Visualization (Grafana)

**Deployment**:
- **Helm Chart**: Included in `kube-prometheus-stack`
- **Storage**: 10Gi PVC for dashboards and data sources
- **Namespace**: `monitoring`
- **Default Credentials**: `admin/Admin123!` (change for production)

**Features**:
- Pre-configured datasources: Prometheus, Jaeger, Loki (optional)
- Custom dashboards: `infra/k8s/base/observability/grafana-dashboards.yaml`
- Dashboard provisioning: Auto-loads dashboards from ConfigMaps
- Alerting: Integrated with Prometheus AlertManager

**Access**:
```bash
kubectl -n monitoring port-forward svc/monitoring-grafana 3000:80
# http://localhost:3000 (admin/Admin123!)
```

### Distributed Tracing (Jaeger)

**Deployment**:
- **Manifest**: `infra/k8s/base/observability/jaeger-deploy.yaml`
- **Namespace**: `observability`
- **Storage**: In-memory (dev) or persistent storage (production)
- **Receives traces**: Via OpenTelemetry Collector

**Instrumentation**:
- OpenTelemetry SDK for Node.js and Python
- Automatic trace propagation via gRPC metadata
- Custom spans for business logic
- See `infra/k8s/base/observability/otel-instrumentation.md` for guide

**Trace Flow**:
```
Client Request
    │
    ├─► Caddy (span: edge)
    ├─► API Gateway (span: gateway)
    ├─► Backend Service (span: service)
    └─► Database Query (span: db)
```

**Access**:
```bash
kubectl -n observability port-forward svc/jaeger 16686:16686
# http://localhost:16686
```

### OpenTelemetry Collector

**Deployment**:
- **Manifest**: `infra/k8s/base/observability/otel-collector-deploy.yaml`
- **Namespace**: `observability`
- **Configuration**: ConfigMap with OTLP receivers and exporters

**Receivers**:
- **OTLP**: gRPC (port 4317), HTTP (port 4318)
- **Prometheus**: Scrapes Prometheus metrics

**Processors**:
- **Batch**: Batches traces and metrics for efficient export
- **Memory Limiter**: Prevents OOM by limiting memory usage
- **Resource Detection**: Adds resource attributes (pod, node, etc.)

**Exporters**:
- **Jaeger**: Exports traces to Jaeger backend
- **Prometheus**: Exports metrics to Prometheus
- **New Relic**: Exports traces and metrics to New Relic (optional)
- **Logging**: Debug logging for troubleshooting

**Pipelines**:
- **Traces**: OTLP → Batch → Jaeger + New Relic
- **Metrics**: Prometheus + OTLP → Batch → Prometheus + New Relic
- **Logs**: (Future) OTLP → Batch → Loki/ELK

**Configuration**:
```yaml
# infra/k8s/base/observability/otel-collector-deploy.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  jaeger:
    endpoint: jaeger.observability.svc.cluster.local:14250
  prometheus:
    endpoint: "0.0.0.0:8889"
  newrelic:
    apikey: ${NEW_RELIC_LICENSE_KEY}
    endpoint: https://otlp.nr-data.net
```

### New Relic Integration (Optional)

**Purpose**: Cloud observability platform for production monitoring.

**Setup**:
1. Get New Relic license key from https://one.newrelic.com/admin-portal/api-keys/home
2. Create secret: `kubectl create secret generic newrelic-secret --from-literal=license-key='YOUR_KEY' -n observability`
3. OpenTelemetry Collector automatically exports to New Relic

**Configuration**:
- **Secret**: `infra/k8s/base/observability/newrelic-secret.yaml`
- **Exporter**: Configured in OpenTelemetry Collector
- **Endpoint**: `https://otlp.nr-data.net` (New Relic OTLP endpoint)

**Features**:
- Traces and metrics exported to New Relic
- APM (Application Performance Monitoring)
- Infrastructure monitoring
- Custom dashboards and alerts

**Production Setup**: See `infra/k8s/OBSERVABILITY-PRODUCTION-SETUP.md` for comprehensive setup and troubleshooting guide.

**Quick Fix Script**: Run `bash infra/k8s/scripts/fix-observability-production.sh` to automatically fix common issues:
- Grafana CrashLoopBackOff
- Prometheus Helm chart failures
- OpenTelemetry Collector duplicate pods
- Linkerd/Istio control plane restarts
- DNS resolution issues
- Sidecar injection problems

### Service Mesh (Linkerd - Optional)

**Purpose**: Service mesh with mTLS, traffic management, and advanced observability.

**Installation**:
- **Script**: `infra/k8s/scripts/install-linkerd.sh`
- **CLI Required**: `curl -sL https://run.linkerd.io/install-edge | sh`

**Features**:
- **mTLS**: Automatic mutual TLS between services
- **Traffic Management**: Request routing, retries, timeouts, circuit breakers
- **Metrics**: Service-level metrics (request rate, latency, success rate)
- **Topology**: Visual service dependency graph
- **Auto-injection**: Automatic sidecar injection via namespace annotation
- **Linkerd Viz**: Dashboard for service mesh visualization

**Usage**:
```bash
# Install Linkerd
bash infra/k8s/scripts/install-linkerd.sh

# Enable auto-injection
kubectl annotate namespace off-campus-housing-tracker linkerd.io/inject=enabled

# Access dashboard
linkerd viz dashboard
```

**Benefits**:
- Automatic mTLS between services
- Service-level observability without code changes
- Traffic splitting for canary deployments
- Request-level retries and timeouts

### Logging

**Structured Logging**:
- JSON format for easy parsing
- Correlation IDs for request tracing
- Log levels: DEBUG, INFO, WARN, ERROR

**Log Aggregation** (Current):
- Kubernetes pod logs via `kubectl logs`
- **Future**: Centralized logging with ELK stack or Loki

**Access**:
```bash
# View service logs
kubectl -n off-campus-housing-tracker logs -f deployment/api-gateway

# View all pods in namespace
kubectl -n off-campus-housing-tracker logs -f --all-containers=true
```

### Documentation

- `infra/k8s/OBSERVABILITY.md` - Comprehensive observability guide
- `infra/k8s/GRAFANA-GUIDE.md` - Grafana usage and dashboard creation
- `infra/k8s/base/observability/otel-instrumentation.md` - OpenTelemetry instrumentation guide

## Shopping Cart Architecture

### Amazon-Style Cart Design

**Problem Statement:**
Marketplace platforms require sophisticated cart experiences where users frequently
encounter multiple identical items (same title, condition) that need differentiation.
Industry leaders (Amazon, eBay) solve this through catalog identification and user
notes.

**Why This Matters:**
- **User Experience**: Users need to distinguish between multiple identical items
  in their cart (e.g., two "Beatles - Abbey Road" records, both "Very Good" condition,
  but one has original packaging and one doesn't)
- **Seller Flexibility**: Sellers can list the same item multiple times with different
  catalog IDs (e.g., different pressings, different sellers, different batches)
- **Purchase Clarity**: Buyers can add notes to remember why they added an item or
  distinguish between similar items
- **Marketplace Standards**: Aligns with industry-standard UX patterns from Amazon,
  eBay, and other major marketplaces

**Investigation of Alternatives:**
- **Option 1: Use listing ID only** - Rejected: Listing ID changes when item is
  reposted, doesn't help differentiate identical items
- **Option 2: Composite key (title + condition)** - Rejected: Too restrictive,
  prevents sellers from listing same item multiple times
- **Option 3: Catalog ID + Notes (Chosen)** - Best: Provides seller flexibility
  (catalog ID) and buyer clarity (notes), aligns with industry standards

### Technical Implementation

**Database Schema:**
- **Listings DB**: `catalog_id VARCHAR(128)` in `listings.listings` table
  - Unique constraint on `(user_id, title, condition, catalog_id)` when catalog_id
    is provided
  - Index on `catalog_id` for fast lookups
  - Allows NULL catalog_id for items without catalog distinction
- **Shopping DB**: `notes TEXT` in `shopping.shopping_cart` table
  - User-specific notes per cart item
  - Allows differentiation of items with same condition

**Cross-Service Data Enrichment:**
- Shopping service connects to listings database to fetch item details
- Uses `listingsPool` connection pool for efficient cross-database queries
- Enriches cart items with listing metadata (image, title, condition, catalog_id)
  before returning to frontend

**API Design:**
- **GET /cart**: Returns enriched cart items with full listing details
- **POST /cart**: Accepts optional `notes` field for new cart items
- **PUT /cart/:itemId**: Allows updating `notes` field for existing cart items
- **POST /listings**: Accepts optional `catalog_id` in request body
- **PUT /listings/:id**: Allows updating `catalog_id` for existing listings

**Frontend Implementation:**
- Amazon-style grid layout with responsive design
- Visual badges for condition and catalog ID
- Inline editing for notes with optimistic updates
- Lazy loading for images to reduce initial page load

**Performance Considerations:**
- Cart GET endpoint performs one additional query per item to fetch listing details
- Consider caching listing details if cart contains many items
- Index on `catalog_id` ensures fast lookups

## Performance Optimizations

### Performance Testing & Benchmarking

**Comprehensive Percentile Coverage**:
- All performance testing scripts (k6 and pgbench) include extended percentile coverage: **p50, p95, p99, p999, p9999, p99999, p999999, p9999999, and p100**
- **p9999999 (99.99999th percentile)**: Enables detection of extreme tail latencies (1 in 10 million requests) for comprehensive performance analysis
- **k6 scripts**: `scripts/load/k6-mixed.js`, `scripts/load/k6-reads.js`, `scripts/load/all-in-one-k6.js`, `scripts/load/k6-summary-handler.js`
- **pgbench scripts**: Service-specific benchmark scripts for auth, social, listings, shopping, analytics, auction-monitor, and python-ai services
- **Database schema**: All benchmark results stored in `bench.results` table with full percentile columns
- **CSV export**: Results exported to CSV with all percentile metrics for analysis

**Benchmark Execution**:
- **Service-specific benchmarks**: Each service has its own pgbench sweep script
- **Multiple client counts**: Tests run with varying client counts (8, 16, 24, 32, 48, 64, etc.)
- **Extended duration**: Higher client counts use extended test durations (3x) for stability
- **Cold cache support**: Optional cold cache phase for realistic performance testing
- **Fast temp tablespace**: Optional RAM-based temp files to reduce p999 spikes

**Performance Metrics**:
- **Throughput (TPS)**: Transactions per second
- **Latency percentiles**: p50, p95, p99, p999, p9999, p99999, p999999, p9999999, p100
- **Cache hit ratio**: Database buffer cache effectiveness
- **I/O metrics**: Disk I/O timing and statistics
- **CPU usage**: CPU share and utilization

**Load tests catalog**: For a full map of k6 scripts (read, soak, sweep, limit, constant stress, Little's Law, p99…p100) and pgbench integration, see **`scripts/load/LOAD_TESTS_CATALOG.md`**. Future integration of k6 and pgbench into `run-all-test-suites.sh` is documented there.

### Database Optimizations

**Partitioning**:
- Records table partitioned by `created_at` (monthly partitions)
- Improves query performance for time-based queries
- Easier data archival

**Indexing Strategy**:
- **trgm (trigram)**: Fast prefix matching for search
- **knn (vector)**: Semantic search using embeddings
- **percent**: Percentage-based filtering

**Connection Pooling**:
- Prisma connection pool per service
- Configurable pool size based on service load

### Shopping Cart Architecture

### Amazon-Style Cart Design

**Problem Statement:**
Marketplace platforms require sophisticated cart experiences where users frequently
encounter multiple identical items (same title, condition) that need differentiation.
Industry leaders (Amazon, eBay) solve this through catalog identification and user
notes.

**Why This Matters:**
- **User Experience**: Users need to distinguish between multiple identical items
  in their cart (e.g., two "Beatles - Abbey Road" records, both "Very Good" condition,
  but one has original packaging and one doesn't)
- **Seller Flexibility**: Sellers can list the same item multiple times with different
  catalog IDs (e.g., different pressings, different sellers, different batches)
- **Purchase Clarity**: Buyers can add notes to remember why they added an item or
  distinguish between similar items
- **Marketplace Standards**: Aligns with industry-standard UX patterns from Amazon,
  eBay, and other major marketplaces

**Investigation of Alternatives:**
- **Option 1: Use listing ID only** - Rejected: Listing ID changes when item is
  reposted, doesn't help differentiate identical items
- **Option 2: Composite key (title + condition)** - Rejected: Too restrictive,
  prevents sellers from listing same item multiple times
- **Option 3: Catalog ID + Notes (Chosen)** - Best: Provides seller flexibility
  (catalog ID) and buyer clarity (notes), aligns with industry standards

### Technical Implementation

**Database Schema:**
- **Listings DB**: `catalog_id VARCHAR(128)` in `listings.listings` table
  - Unique constraint on `(user_id, title, condition, catalog_id)` when catalog_id
    is provided
  - Index on `catalog_id` for fast lookups
  - Allows NULL catalog_id for items without catalog distinction
- **Shopping DB**: `notes TEXT` in `shopping.shopping_cart` table
  - User-specific notes per cart item
  - Allows differentiation of items with same condition

**Cross-Service Data Enrichment:**
- Shopping service connects to listings database to fetch item details
- Uses `listingsPool` connection pool for efficient cross-database queries
- Enriches cart items with listing metadata (image, title, condition, catalog_id)
  before returning to frontend

**API Design:**
- **GET /cart**: Returns enriched cart items with full listing details
- **POST /cart**: Accepts optional `notes` field for new cart items
- **PUT /cart/:itemId**: Allows updating `notes` field for existing cart items
- **POST /listings**: Accepts optional `catalog_id` in request body
- **PUT /listings/:id**: Allows updating `catalog_id` for existing listings

**Frontend Implementation:**
- Amazon-style grid layout with responsive design
- Visual badges for condition and catalog ID
- Inline editing for notes with optimistic updates
- Lazy loading for images to reduce initial page load

**Performance Considerations:**
- Cart GET endpoint performs one additional query per item to fetch listing details
- Consider caching listing details if cart contains many items
- Index on `catalog_id` ensures fast lookups

### Caching Strategy

**Redis Caching**:
- Search results cached with normalized keys
- User-specific cache invalidation
- Singleflight pattern prevents cache stampedes
- **Auction Monitor**: Platform search results with Lua singleflight (prevents thundering herd and cache stampede)

**Nginx Micro-Cache**:
- Short TTL (5-10 seconds) for static assets
- Cache headers for browser caching

### System Performance Limits & Bottleneck Analysis

**Comprehensive Load Testing Results** (December 27, 2025):

**Test Methodology**:
- **Smoke Test**: `scripts/test-microservices-http2-http3.sh` - Validates all services via HTTP/2 and HTTP/3
- **k6 Comprehensive Test**: `scripts/load/k6-all-services-comprehensive.js` - Full service load testing
- **Limit-Finding Test**: `scripts/load/k6-e2e-find-limit.js` - Identifies maximum capacity and bottlenecks
- **HTTP/3 Testing**: Uses `HTTP_VERSION=HTTP/3` environment variable or curl-based testing via `http3.sh` helper

**System Limits Identified**:
- **Optimal Load**: ~50-100 VUs (Virtual Users) before performance degradation
- **Maximum Tested**: 500 VUs (system completely overwhelmed)
- **Degradation Point**: Services start showing errors above 100 VUs
- **Critical Failure Point**: 500 VUs causes 80-96% error rates

**Test Results Summary**:

**k6 Comprehensive Test (HTTP/2)** - 50 VUs, 11 minutes:
- ✅ **Auth Service**: 99.91% success (8 errors out of 9,043 requests)
- ✅ **Records Service**: 100% success (13,530 requests)
- ✅ **Listings Service**: 99.75% success (11,629 requests)
- ✅ **Social Service**: 99.96% success (9,033 requests)
- ✅ **Shopping Service**: 99.91% success (11,807 requests)
- ✅ **Analytics Service**: 99.95% success (4,520 requests)
- ⚠️ **Python AI Service**: 67.69% success (1,184 requests, 565 errors)

**Limit-Finding Test (HTTP/2)** - 500 VUs, 3m46s:
- ❌ **Auth Service**: 0% success (1,026 errors) - **PRIMARY BOTTLENECK**
- ❌ **Records Service**: 17.88% success (8,638 errors)
- ❌ **Listings Service**: 21.74% success (8,207 errors)
- ❌ **Social Service**: 19.71% success (4,019 errors)
- ❌ **Shopping Service**: 19.68% success (8,121 errors)
- ❌ **Analytics Service**: 19.66% success (3,259 errors)
- ❌ **Python AI Service**: 15.33% success (403 errors)
- **Overall Error Rate**: 80.77%

**Limit-Finding Test (HTTP/3)** - 500 VUs, 3m55s:
- ❌ **Auth Service**: 0% success (308 errors) - **PRIMARY BOTTLENECK**
- ⚠️ **Records Service**: 71.31% success (1,116 errors) - **Better than HTTP/2**
- ✅ **Listings Service**: 93.70% success (239 errors) - **Much better than HTTP/2**
- ✅ **Social Service**: 88.18% success (182 errors) - **Much better than HTTP/2**
- ✅ **Shopping Service**: 87.53% success (398 errors) - **Much better than HTTP/2**
- ✅ **Analytics Service**: 87.94% success (161 errors) - **Much better than HTTP/2**
- ⚠️ **Python AI Service**: 42.62% success (175 errors)
- **Overall Error Rate**: 17.94% - **Significantly better than HTTP/2**

**Key Finding**: HTTP/3 (QUIC) shows **significantly better performance** than HTTP/2 under extreme load, with most services maintaining 85-95% success rates vs 15-20% for HTTP/2.

**Auth Service Bottleneck - Security vs Performance Trade-off**:

**Root Cause**: **bcrypt password hashing is intentionally CPU-intensive for security**

**Current Configuration**:
- **bcrypt Rounds**: 8 (reduced from 10 for performance, still secure)
- **Concurrent Operations**: 64 per pod (queue-managed)
- **Service Replicas**: 4 pods
- **Total Capacity**: ~256 concurrent bcrypt operations across all pods
- **CPU Allocation**: 2000m (2 cores) per pod
- **Node CPU**: 12 cores total (allows for multiple services and monitoring overhead)

**Why This Is Intentional**:
1. **Security Requirement**: bcrypt is designed to be slow and CPU-intensive to prevent brute-force attacks
2. **Password Protection**: Higher bcrypt rounds = better security, but slower performance
3. **Industry Standard**: 8-10 rounds is standard for production systems
4. **Security Budget**: We must budget CPU resources for security operations

**Performance Characteristics**:
- **Registration**: Requires bcrypt.hash() - CPU-intensive (~50-200ms per operation)
- **Login**: Requires bcrypt.compare() - CPU-intensive (~50-200ms per operation)
- **Queue Management**: Prevents CPU contention by limiting concurrent operations
- **Queue Saturation**: At 500 VUs, queue backs up, causing timeouts and failures

**Why Auth Fails First**:
- **Gatekeeper Service**: All other services depend on auth tokens from auth service
- **CPU-Bound Operations**: bcrypt operations are synchronous and CPU-bound
- **Queue Limits**: 64 concurrent operations per pod = bottleneck under extreme load
- **Cascading Failures**: When auth fails, all downstream services fail (no tokens)

**Proving the Bottleneck Under the Wire**:

We use comprehensive monitoring to prove why auth is the bottleneck:

1. **tcpdump Protocol Verification**:
   - **HTTP/2**: Captures TCP packets on port 443 (proves HTTP/2 uses TCP)
   - **HTTP/3**: Captures UDP packets on port 443 (proves HTTP/3 uses QUIC/UDP)
   - **Analysis**: Counts TCP vs UDP packets to verify protocol usage
   - **Proof**: Shows HTTP/3 actually uses QUIC (UDP), not HTTP/2 (TCP)

2. **strace System Call Monitoring**:
   - **Monitors**: System calls during bcrypt operations (clone, fork, execve, gettimeofday, nanosleep)
   - **Frequency**: Samples every 10 seconds during load tests
   - **Shows**: High frequency of system calls during bcrypt operations
   - **Proof**: Demonstrates CPU-intensive nature of bcrypt (frequent system calls)

3. **htop-Style CPU Monitoring**:
   - **Node-Level**: Shows overall node CPU usage (12 cores total)
   - **Pod-Level**: Shows auth-service pod CPU approaching 2000m limit
   - **Process-Level**: Shows Node.js process CPU spikes during bcrypt.hash()
   - **Frequency**: Every 2 seconds (real-time CPU spike monitoring)
   - **Includes**: /proc/stat for actual CPU time, process CPU percentage
   - **Proof**: Visual evidence of CPU spikes during bcrypt operations

4. **Why CPU Spikes Occur**:
   - **bcrypt.hash()**: Takes 50-200ms per operation, uses significant CPU
   - **bcrypt.compare()**: Similar CPU usage for password verification
   - **Queue Saturation**: At 500 VUs, 64 concurrent operations per pod cannot keep up
   - **CPU Limit**: 2000m (2 cores) per pod is fully utilized during bcrypt operations
   - **Node Capacity**: 12 cores total allows for multiple services, but auth-service consumes significant CPU

**Monitoring Script**: `scripts/run-k6-with-comprehensive-monitoring.sh`
- Runs HTTP/2 and HTTP/3 limit tests with full monitoring
- Generates comprehensive report with protocol verification
- Documents CPU spikes and system call patterns
- Proves under the wire that HTTP/3 uses QUIC (UDP) not HTTP/2 (TCP)

**Security Budget Planning**:

**Current Capacity** (4 replicas, 64 concurrent per pod):
- **Theoretical Maximum**: 256 concurrent auth operations
- **Practical Maximum**: ~100-150 VUs before degradation
- **At 500 VUs**: Queue saturation, 0% success rate

**Scaling Strategies**:
1. **Horizontal Scaling**: Add more auth-service replicas (each adds 64 concurrent operations)
   - 8 replicas = 512 concurrent operations
   - 16 replicas = 1,024 concurrent operations
2. **Vertical Scaling**: Increase CPU limits per pod (allows more concurrent operations)
   - Current: 2000m (2 cores) per pod
   - Increase to: 4000m (4 cores) per pod = potentially 128 concurrent operations per pod
   - **Node Capacity**: 12 cores total (allows for multiple services and monitoring overhead)
3. **bcrypt Rounds Tuning**: Balance security vs performance
   - Current: 8 rounds (good balance)
   - Production: 10 rounds (more secure, slower)
   - Dev/Test: 6 rounds (faster, less secure - not recommended for production)
4. **Queue Size Tuning**: Increase `MAX_CONCURRENT_BCRYPT` per pod
   - Current: 64 concurrent operations
   - Increase to: 128 concurrent operations (requires more CPU)

**Recommendations**:
- **Production Load**: Plan for 50-100 concurrent users per auth-service replica
- **High Load**: Scale to 8-16 replicas for 500+ concurrent users
- **Security First**: Never reduce bcrypt rounds below 8 for production
- **Monitor Queue**: Track `bcrypt_queue` and `bcrypt_active` metrics in health checks
- **HTTP/3 Preferred**: Use HTTP/3 (QUIC) for better performance under load

**Monitoring**:
- **Health Check Endpoint**: `/healthz` includes bcrypt queue status
- **Metrics**: `bcrypt_queue` (queue length), `bcrypt_active` (active operations)
- **Alerts**: Set alerts for queue length > 50 or active operations > 60
- **Comprehensive Monitoring**: Use `scripts/run-k6-with-comprehensive-monitoring.sh` for full monitoring:
  - **tcpdump**: Verifies HTTP/2 (TCP) vs HTTP/3 (UDP/QUIC) protocol usage
  - **strace**: Monitors system calls during bcrypt operations (proves CPU-intensive nature)
  - **htop-style monitoring**: Shows CPU spikes in real-time (node, pod, and process level)
  - **Process-level CPU**: Shows Node.js process CPU usage during bcrypt operations
  - **Protocol Verification**: Proves under the wire that HTTP/3 uses QUIC (UDP) not HTTP/2 (TCP)

### HTTP/3 (QUIC) Benefits

**Performance Improvements**:
- Reduced latency with 0-RTT connection establishment
- Better performance on lossy networks
- Multiplexing without head-of-line blocking
- **Significantly better performance under extreme load** (17.94% error rate vs 80.77% for HTTP/2 at 500 VUs)

**Implementation**:
- Caddy handles QUIC automatically
- Fallback to HTTP/2 if QUIC unavailable
- Client support required (modern browsers, curl with HTTP/3)
- **k6 HTTP/3 Testing**: Use `HTTP_VERSION=HTTP/3` environment variable or `scripts/load/k6-http3-toolchain.js`

### k6 HTTP/3 Toolchain

**Custom k6 Binary with HTTP/3 Extension**:
- **Status**: ✅ **Extension built and loads successfully**
- **Binary**: `.k6-build/bin/k6-http3`
- **Build Script**: `scripts/build-k6-http3.sh`
- **Extension**: `github.com/off-campus-housing-tracker/xk6-http3` (local development using quic-go)
- **Documentation**: See `test-results/K6_HTTP3_TOOLCHAIN_STATUS_12-22_tom.md` for complete status
- **Toolchain Script**: `scripts/load/k6-http3-toolchain.js` - Custom toolchain for HTTP/3 testing

**How It Works**:
- **xk6 Extension**: Custom Go extension using `quic-go` library for HTTP/3 (QUIC) support
- **Build Process**: Uses xk6 to build custom k6 binary with local extension via replace directive
- **Extension Registration**: Automatically registers as `k6/x/http3` module
- **QUIC Client**: Implements HTTP/3 client with proper QUIC configuration (HandshakeIdleTimeout 10s, MaxIdleTimeout 60s)
- **Toolchain Script**: `k6-http3-toolchain.js` provides HTTP/3 request helpers and fallback to standard k6

**Current Limitation**:
- ⚠️ **NodePort UDP Routing**: HTTP/3 (QUIC) over NodePort (30443) has UDP routing issues causing connection timeouts
- **Root Cause**: External k6 runs outside the cluster (Colima/k3s or Kind); NodePort UDP may not route QUIC correctly
- **Workaround**: Use curl-based HTTP/3 testing (`scripts/test-microservices-http2-http3.sh`) or in-cluster k6 jobs; packet capture (tcpdump/tshark) verifies QUIC at wire level

**Extension Features**:
- ✅ HTTP/3 client using `quic-go` library
- ✅ GET and POST methods implemented
- ✅ Configurable timeouts (60s default for QUIC handshake)
- ✅ TLS configuration (insecureSkipTLSVerify for dev)
- ✅ Headers and error handling

**Usage**:
```bash
# Build custom k6 with HTTP/3 extension
./scripts/build-k6-http3.sh

# Run HTTP/3 test using environment variable (recommended)
HTTP_VERSION=HTTP/3 k6 run scripts/load/k6-e2e-find-limit.js

# Run HTTP/3 test with custom toolchain (experimental, may timeout due to NodePort UDP routing)
./scripts/run-k6-http3-test.sh

# Or directly
.k6-build/bin/k6-http3 run scripts/load/k6-http3-toolchain.js
```

**For Reliable HTTP/3 Testing**:
- ✅ **Use environment variable**: `HTTP_VERSION=HTTP/3 k6 run <script>` (works with standard k6)
- ✅ **Use curl-based testing**: `scripts/test-microservices-http2-http3.sh`
- ✅ **Verified working**: tcpdump confirms QUIC (UDP) usage
- ✅ **Production-ready**: Reliable and tested

**Test Results** (December 27, 2025):
- **HTTP/3 Performance**: 17.94% error rate at 500 VUs (vs 80.77% for HTTP/2)
- **Service Success Rates**: 85-95% for most services (vs 15-20% for HTTP/2)
- **Auth Service**: Still bottleneck (0% success) due to bcrypt CPU limits, not protocol

**Future Improvements**:
- Run k6 inside Kubernetes cluster (use ClusterIP directly)
- Port-forward UDP port 443 from Caddy pod
- Use cluster node network namespace or in-cluster k6 (similar to http3.sh)
- Wait for native k6 HTTP/3 support in future versions

### HTTP/3 Protocol Verification

**Verification Script**: `scripts/verify-http3-with-tcpdump.sh`

**Purpose**: Verify that HTTP/3 is actually using QUIC (UDP) protocol, not just HTTP/2 (TCP)

**Methodology**:
1. **Packet Capture**: Uses tcpdump in Caddy pod to capture UDP traffic on port 443 (QUIC)
2. **Test Execution**: Runs HTTP/3 requests using curl (via `http3.sh` helper) since k6 doesn't support HTTP/3 natively
3. **Analysis**: Analyzes pcap file to count UDP packets (QUIC) vs TCP packets (HTTP/2)
4. **Verification**: Confirms QUIC usage by detecting UDP packets on port 443

**Results**:
- ✅ **QUIC Verified**: UDP packets detected on port 443 during HTTP/3 requests
- ✅ **Protocol Confirmed**: HTTP/3 uses QUIC (UDP) as expected
- ✅ **Wireshark Compatible**: pcap files available for detailed analysis

**Usage**:
```bash
# Run HTTP/3 verification
./scripts/verify-http3-with-tcpdump.sh

# Results saved to: test-results/YYYYMMDD-HHMMSS-http3-verification/
# - verification.log: Complete test log
# - quic-capture.pcap: Packet capture file (Wireshark compatible)
# - k6-metrics.txt: Extracted metrics
```

**Wireshark Analysis**:
```bash
# Open pcap file in Wireshark
wireshark test-results/YYYYMMDD-HHMMSS-http3-verification/quic-capture.pcap

# Look for:
# - UDP packets on port 443 (QUIC)
# - QUIC protocol in packet details
# - HTTP/3 in application layer
```

**Comparison Testing**: `scripts/compare-http2-http3.sh`
- Runs both HTTP/2 and HTTP/3 tests
- Generates comparison report with metrics
- Outputs JSON results for both protocols
- Creates timestamped comparison folder

**Important Note**: k6 v1.4.2 does NOT natively support HTTP/3 yet. The toolchain script uses `httpVersion: 'HTTP/3'` but may fall back to HTTP/2. For actual HTTP/3 testing, use `scripts/test-microservices-http2-http3.sh` which uses curl with HTTP/3 support via the `http3.sh` helper.

## Security Architecture

### Authentication & Authorization

**Production-Tier Authentication (Auth Service)**:

**Google OAuth 2.0**:
- Full OAuth flow with Google Cloud Console integration
- Published OAuth app allows any Google user to sign in (not just test users)
- Consent screen with privacy policy and terms of service URLs
- Callback URL routing via ngrok for local development/testing
- Client ID and Secret stored in Kubernetes secrets
- Routes: `/api/auth/google` (initiate), `/api/auth/google/callback` (callback)

**SMS/Phone Verification**:
- Multi-provider abstraction layer with lazy-loaded SDKs
- Supported providers: Mock (default), Twilio, AWS SNS, Vonage, MessageBird
- Provider selection via `SMS_PROVIDER` environment variable
- Mock provider for development/testing with `/api/auth/sms/mock/messages` endpoint
- Lazy loading prevents build failures if optional dependencies are missing
- Rate limiting and verification code generation

**Passkey/WebAuthn**:
- Modern passwordless authentication using WebAuthn API
- Mock data support for testing (controlled via `ALLOW_MOCK_PASSKEY_DATA`)
- Production-ready WebAuthn configuration (`WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`)
- Client-side validation with server-side verification
- Routes: `/api/auth/passkeys/register/start`, `/api/auth/passkeys/register/finish`, `/api/auth/passkeys/login/start`, `/api/auth/passkeys/login/finish`

**MFA/TOTP**:
- Time-based one-time password (TOTP) support
- QR code generation for authenticator apps
- Verification code validation
- Routes: `/api/auth/mfa/setup`, `/api/auth/mfa/verify`, `/api/auth/mfa/disable`

**Privacy & Terms Pages**:
- Required for OAuth consent screen compliance
- Served directly from auth-service (`/privacy`, `/terms`)
- Separate ingress routing to bypass rewrite-target conflicts
- HTML pages with proper styling and content
- Accessible via public URLs for Google Cloud Console configuration

**JWT-Based Authentication**:
- Access tokens: Short-lived (15 minutes)
- Refresh tokens: Long-lived (7 days)
- Token revocation: Redis blacklist

**API Gateway Security**:
- JWT verification on all `/api/*` routes
- Rate limiting per user
- Identity injection: `x-user-id`, `x-user-email`, `x-user-jti` headers

**Service Authorization**:
- Services receive identity via headers
- Records service enforces ownership on CRUD operations
- Role-based access control (future)

### TLS Security

**k6 Load Test TLS Configuration**:
- **CA Certificate**: Mounted at `/etc/ssl/certs/k6-ca.crt` in k6 pods
- **Environment Variable**: `SSL_CERT_FILE=/etc/ssl/certs/k6-ca.crt` set in all k6 test jobs
- **ConfigMap**: `k6-ca-cert` contains `ca.crt` (mkcert root CA) for all namespaces
- **Scripts Updated**: All k6 JavaScript test scripts removed `insecureSkipTLSVerify: true` for production-ready testing
- **Validation**: Tests fail if CA certificate is missing, ensuring strict TLS is always enforced
- **Shopping Service Tests**: All shopping service k6 tests (`k6-shopping-stress.js`, `k6-shopping-ramp.js`, `k6-shopping-db-validation.js`, `k6-bottleneck-finder.js`) use strict TLS verification with CA certificate validation
- **Test Scripts**: `run-k6-shopping.sh` and `find-bottlenecks.sh` enforce strict TLS by mounting CA certificate ConfigMap and setting `SSL_CERT_FILE` environment variable
- **ClusterIP Access**: Tests use ClusterIP FQDN (`caddy-h3.ingress-nginx.svc.cluster.local:443`) for in-cluster testing to avoid NodePort TLS passthrough issues in Colima/k3s (or Kind)

**Strict TLS Enforcement**:
- **Edge Layer**: Caddy configured with `protocols tls1.2 tls1.3` - only TLS 1.2 and 1.3 are accepted; TLS 1.1 and below are rejected.
- **Service-Level TLS**: All services enforce strict TLS with:
  - `NODE_TLS_REJECT_UNAUTHORIZED=1` environment variable (rejects self-signed certificates)
  - CA certificate mounted from `dev-root-ca` Kubernetes secret at `/certs/dev-root.pem`
  - `NODE_EXTRA_CA_CERTS=/certs/dev-root.pem` for Node.js CA trust store
  - Volume mount: `dev-root-ca` secret with `dev-root.pem` key
- **Services with Strict TLS**: auth-service, listings-service, records-service, social-service, shopping-service, analytics-service, api-gateway, python-ai-service
- **gRPC Health Checks**: Services with gRPC endpoints use `grpc.health.v1.Health/Check` protocol (HTTP/2/3) for Kubernetes health probes:
  - **auth-service**: Uses `grpc-health-probe` binary for gRPC health checks
  - **python-ai-service**: Uses native Kubernetes `grpc` probe type
  - **Other services**: HTTP health checks via `/healthz` endpoint
- **Validation**: Test scripts verify strict TLS enforcement:
  - `scripts/test-http2-http3-strict-tls.sh` - Tests TLS 1.2/1.3 acceptance and TLS 1.1 rejection
  - `scripts/test-full-chain-with-rotation.sh` - Full chain validation with strict TLS

**Certificate Management**:
- mkcert for local development
- Kubernetes secrets for certificate storage (`dev-root-ca` secret in `off-campus-housing-tracker` namespace)
- Zero-downtime CA rotation via admin API
- CA certificate distributed to all services via volume mounts

### Network Security

**Service Isolation**:
- Kubernetes network policies (future)
- Database isolation (8 separate instances)
- Redis password protection

**Ingress Security**:
- TLS termination at Caddy
- Host-based routing
- Rate limiting at multiple layers

**Kafka Strict TLS**:
- **SSL/TLS Encryption**: Kafka configured with strict TLS on port 9093
- **Status**: ✅ Fully configured and operational
- **SSL Certificates**: Generated and stored in `kafka-ssl-secret` Kubernetes secret
  - CA certificate (ca-cert.pem, ca-key.pem)
  - Broker certificate (broker-cert.pem, broker-key.pem)
  - Keystore (kafka.keystore.jks)
  - Truststore (kafka.truststore.jks)
- **Environment Variables**: All required Confluent Kafka SSL env vars configured:
  - `KAFKA_SSL_KEYSTORE_LOCATION=/etc/kafka/secrets`
  - `KAFKA_SSL_KEYSTORE_FILENAME=kafka.keystore.jks`
  - `KAFKA_SSL_KEYSTORE_CREDENTIALS` (from secret)
  - `KAFKA_SSL_KEY_CREDENTIALS` (from secret)
  - `KAFKA_SSL_TRUSTSTORE_LOCATION=/etc/kafka/secrets`
  - `KAFKA_SSL_TRUSTSTORE_FILENAME=kafka.truststore.jks`
  - `KAFKA_SSL_TRUSTSTORE_CREDENTIALS` (from secret)
  - `KAFKA_SSL_CLIENT_AUTH=none` (can be set to `required` for strict TLS)
- **Listeners**: 
  - PLAINTEXT (9092): Available for migration
  - SSL (9093): Primary listener with strict TLS
- **Service Configuration**: Python AI service and other services use SSL port (9093)
- **Certificate Management**: Certificates mounted from Kubernetes secret, passwords stored securely
- **Documentation**: See `docs/kafka-ssl-setup.md` for complete setup guide

## Performance Optimizations

### Incremental CA Rotation Limit Finding

**Purpose**: Systematically find maximum sustainable throughput during CA and leaf certificate rotation with zero downtime.

**Implementation**:
- **`scripts/load/k6-find-ca-rotation-limit.js`**: k6 script that incrementally increases load
  - Starts at baseline: H2=80 req/s, H3=40 req/s
  - Increments: H2 by 10 req/s, H3 by 5 req/s each iteration
  - Stops when: Error rate > 0% or dropped iterations > 1%
  - Past performance target: 460 req/s combined (280 H2 + 180 H3)
  - Uses constant-arrival-rate executor for precise rate control
  - Strict TLS verification with CA certificate validation
  
- **`scripts/find-ca-rotation-limit.sh`**: Wrapper script that orchestrates limit finding
  - Runs certificate rotation during each test iteration
  - Finds maximum sustainable throughput with zero downtime
  - Tracks results across iterations
  - Reports last successful rates
  - Integrates with `scripts/rotation-suite.sh` for certificate rotation

**Enhanced Smoke Test**:
- **`scripts/test-microservices-http2-http3.sh`**: Added explicit protocol verification
  - HTTP/2: `--http2 --tlsv1.3 --tls-max 1.3` flags (no prior knowledge, forced)
  - HTTP/3: `--http3-only --tlsv1.3 --tls-max 1.3` flags (QUIC verification)
  - Verbose logging to verify protocol negotiation
  - Ready for tcpdump and netstat verification

**Certificate Overlap Window**:
- **7-day grace period**: New certificates start validity 7 days before now (notBefore)
- **Purpose**: Allows clients with old certificates to connect during transition
- **Real Application Pattern**: Production-grade certificate rotation strategy
- **Implementation**: `scripts/rotation-suite.sh` - Certificate generation with overlap
- **Benefits**: Zero-downtime certificate rotation with client compatibility

**Limit Test Configuration**:
- **HTTP/2**: H2_MAX_VUS increased from 50 → 60 (+10)
- **HTTP/3**: H3_MAX_VUS increased from 20 → 30 (+10)
- **Rationale**: Each limit test should increment by 10 VUs to find breaking point
- **File**: `scripts/rotation-suite.sh`

### Health Probe and Resource Optimizations

**Health Probe Timeouts Increased**:
- **Records Service**: HTTP probe timeout 3s → 10s, period 5s → 10s
- **Social Service**: gRPC probe timeout 5s → 10s, Kubernetes timeout 10s → 15s
- **Impact**: Prevents pod restarts under load due to probe timeouts
- **Files**: 
  - `infra/k8s/base/records-service/deploy.yaml`
  - `infra/k8s/base/social-service/deploy.yaml`

**Resource Limits Added**:
- **Records & Social Services**: 
  - Requests: 100m CPU / 256Mi memory
  - Limits: 500m CPU / 512Mi memory (Records), 1024Mi memory (Social)
- **Impact**: Prevents Docker Desktop VM corruption while allowing normal operation
- **Rationale**: Reasonable limits that don't overwhelm Docker Desktop

**Database Retry Logic**:
- **Shopping Service**: Added `withRetry` function for database queries
  - Exponential backoff: 1s, 2s, 4s (max 5s)
  - 3 retry attempts for connection errors
  - Applied to critical queries (cart operations, availability checks)
- **Impact**: Reduces 503 errors from database connection timeouts
- **Files**:
  - `services/shopping-service/src/lib/db.ts` - Retry logic implementation
  - `services/shopping-service/src/lib/availability.ts` - Retry for cart availability
  - `services/shopping-service/src/routes/cart.ts` - Retry for cart operations

## Deployment Strategy

### Local development cluster (k3d and Colima)

- **Default path:** **Colima + k3s** with `--network-address` (bridged), API at 127.0.0.1:6443, MetalLB LB IP for HTTP/2 and HTTP/3. Run: `./scripts/run-preflight-scale-and-all-suites.sh`. Bring-back: `./scripts/colima-start-and-ready.sh` or `./scripts/colima-teardown-and-start.sh`. See **ADR 011: Colima k3s primary again** and Runbook items 65, 80.
- **k3d:** Supported with `REQUIRE_COLIMA=0` for CI or lighter local runs. MetalLB and in-cluster Caddy verification; host gateway via hostAliases for Redis/Postgres.
- **9/9 services:** Base app deployments use `imagePullPolicy: IfNotPresent`. Preflight sets `host.docker.internal` in pods via hostAliases so Redis/Postgres on the host are reachable from pods.
- **Guardrails:** Kind/h3 clusters are not supported. MetalLB and custom traffic policy (L2, optional nodeSelector) are verified by `scripts/verify-metallb-and-traffic-policy.sh` (see `docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md`).

### Zero-Downtime Deployments

**NodePort Service Architecture**:
- **Migration from hostNetwork**: Changed from `hostNetwork: true` to `NodePort` service type
- **Multiple Replicas**: 2+ replicas with pod anti-affinity for high availability
- **Service Type**: NodePort (ports 30443 TCP/UDP for HTTPS, 30050 for gRPC h2c)
- **Load Balancing**: Kubernetes Service provides built-in load balancing across replicas
- **Benefits**: Enables multiple pods to run simultaneously, true zero-downtime CA rotation
- **MetalLB (implemented):** LoadBalancer services get a stable external IP from an L2 pool (default `192.168.106.240-192.168.106.250` for Colima). Preflight runs `scripts/install-metallb.sh` and applies Caddy as `type: LoadBalancer`; verify-caddy-strict-tls uses the LB IP:443 when assigned. Override pool with `METALLB_POOL=192.168.x.240-192.168.x.250`. See Runbook: MetalLB.
- **Traffic strategy (no plain RR):** Caddy service uses **sessionAffinity: ClientIP** (timeout 3600s) so each client is pinned to one Caddy pod — avoids round-robin connection churn and reduces reconnects/TLS handshakes. For gRPC/Envoy, in-cluster callers use ClusterIP; custom LB (e.g. ring hash) can be added later if needed.

**RollingUpdate Strategy**:
- `maxUnavailable: 0`: Never have zero pods running
- `maxSurge: 1`: One extra pod during rollout
- `replicas: 2+`: Multiple replicas for true zero-downtime
- **Pod Anti-Affinity**: Prefers pods on different nodes for better high availability

**CA Rotation**:
- **Optimized rotation script**: 1-2 seconds, 100% success rate
- **Direct Kubernetes patch**: Fastest rollout restart method (~0.4s)
- **Pod-by-pod rotation**: New pods come online before old pods terminate
- **Zero downtime**: Multiple replicas ensure continuous service availability
- **k6 distributed load testing**: Validated with k6 constant-arrival-rate executor
- **Maximum proven throughput**: **~397 req/s** (71,447 requests in 180s) with **0% failures**
- **Optimal k6 configuration**: H2=250 req/s (max 160 VUs), H3=150 req/s (max 100 VUs)
- **Breaking point**: 260/160 configuration shows 0.08% failures (violates zero-downtime)
- **Performance progression**: Tested 100/50 → 250/150, all maintaining 0% failures
- **k6 optimization**: Connection reuse, random jitter, constant-arrival-rate executor
- **Optimizations**: Removed PORT detection, eliminated output overhead, direct merge patch
- **Multi-node cluster**: Recommended for optimal pod distribution and HA

### Database Migrations

**Prisma Migrations**:
- Version-controlled schema changes
- Per-service migration strategy
- Rollback support via migration history

**Migration Process**:
1. Create migration: `pnpm prisma migrate dev`
2. Test migration: Apply to dev database
3. Deploy migration: `pnpm prisma migrate deploy` in production

### Backup Strategy

**Automated Backups**:
- Nightly `pg_dump` for all databases
- Weekly `pg_basebackup` for point-in-time recovery
- Redis snapshots nightly
- WAL archiving for continuous backup

**Backup Storage**:
- Local backups in `backups/` directory
- Future: Cloud storage integration (S3, GCS)

## Recovery Procedures & Troubleshooting

> **📖 Comprehensive Troubleshooting Guide**: For detailed documentation of all cluster stabilization issues, root causes, and solutions, see [`docs/Runbook.md`](docs/Runbook.md). The Runbook covers 12 major issues including TLS handshake timeouts, missing secrets/configmaps, Kafka SSL configuration, Caddy errors, resource constraints, probe issues, and more.

### Service Recovery

**Diagnosis**:
1. Check pod status: `kubectl -n off-campus-housing-tracker get pods`
2. Check pod events: `kubectl -n off-campus-housing-tracker describe pod <pod-name>`
3. Check service logs: `kubectl -n off-campus-housing-tracker logs -l app=<service> -c app --tail=200`
4. Check service endpoints: `kubectl -n off-campus-housing-tracker get endpoints <service-name>`

**Common Issues**:
- **Pod CrashLoopBackOff**: Check logs for errors, verify environment variables, check resource limits
- **502 Bad Gateway**: Downstream service unavailable, verify service endpoints and health
- **503 Service Unavailable**: Health check failures, database/Redis connectivity issues
- **504 Gateway Timeout**: Proxy timeout too short, service response time too long

**Recovery Steps**:
1. Restart service: `kubectl -n off-campus-housing-tracker rollout restart deployment/<service>`
2. Verify rollout: `kubectl -n off-campus-housing-tracker rollout status deployment/<service>`
3. Check logs: Monitor logs for errors after restart
4. Test endpoint: `curl -k https://off-campus-housing.local:8443/api/<service>/healthz`

### Database Recovery

**Diagnosis**:
1. Check disk space: `df -h` and `docker system df`
2. Check database connectivity: `psql -h localhost -p <port> -U postgres -d <db> -c "SELECT 1"`
3. Check database logs: `docker-compose logs postgres-* | tail -100`
4. Check database pods: `kubectl -n off-campus-housing-tracker get pods -l app=postgres`

**Common Issues**:
- **"No space left on device"**: Disk full, need cleanup
- **Connection refused**: Database not running, port mismatch
- **Connection timeout**: Network issues, firewall blocking
- **Authentication failed**: Wrong credentials, user doesn't exist

**Recovery Steps**:
1. Cleanup disk space: `docker system prune -a --volumes`
2. Restart databases: `docker-compose restart postgres-*`
3. Check connectivity: Test connection from service pod
4. Restore from backup: `make pg.restore.dump` (see `docs/postgres-infra-setup.md`)

### API Gateway Recovery

**Diagnosis**:
1. Check gateway logs: `kubectl -n off-campus-housing-tracker logs -l app=api-gateway -c app --tail=500`
2. Check proxy errors: Filter logs for "proxy error", "502", "upstream error"
3. Check Redis connection: Filter logs for "redis", "Redis"
4. Test gateway health: `curl -k https://off-campus-housing.local:8443/api/healthz`

**Common Issues**:
- **502 Bad Gateway**: Downstream service unavailable
- **Socket hang up**: Service connection timeout
- **Token revocation failing**: Redis connection issue
- **Path rewrite issues**: Incorrect pathRewrite logic

**Recovery Steps**:
1. Check downstream services: Verify all services are healthy
2. Check Redis: Verify Redis connectivity and password
3. Restart gateway: `kubectl -n off-campus-housing-tracker rollout restart deployment/api-gateway`
4. Verify routes: Test all proxy routes with curl

### Linkerd Recovery

**Diagnosis**:
1. Check Linkerd status: `linkerd check`
2. Check Linkerd pods: `kubectl -n linkerd get pods`
3. Check CoreDNS: `kubectl -n kube-system get pods -l k8s-app=kube-dns`
4. Check injection: `kubectl -n off-campus-housing-tracker get pods -o jsonpath='{.items[*].metadata.annotations.linkerd\.io/inject}'`

**Common Issues**:
- **502 errors with Linkerd**: DNS resolution issues, control plane unavailable
- **Proxy not starting**: Linkerd control plane issues
- **mTLS failures**: Certificate issues, control plane connectivity

**Recovery Steps**:
1. Fix CoreDNS: `kubectl -n kube-system rollout restart deployment/coredns`
2. Restart Linkerd: `kubectl -n linkerd rollout restart deployment --all`
3. Re-enable injection: `kubectl annotate namespace off-campus-housing-tracker linkerd.io/inject=enabled --overwrite`
4. Restart services: `kubectl -n off-campus-housing-tracker rollout restart deployment --all`

**Disable Linkerd** (if causing issues):
1. Disable injection: `kubectl annotate namespace off-campus-housing-tracker linkerd.io/inject- --overwrite`
2. Delete pods: `kubectl -n off-campus-housing-tracker delete pods --all`
3. Verify removal: `kubectl -n off-campus-housing-tracker get pods`

### Health Check Recovery

**Diagnosis**:
1. Check probe status: `kubectl -n off-campus-housing-tracker describe pod <pod> | grep -A 10 "Liveness\|Readiness"`
2. Check probe failures: `kubectl -n off-campus-housing-tracker get events | grep -E "Unhealthy|Failed"`
3. Test health endpoint: `curl -k https://off-campus-housing.local:8443/api/<service>/healthz`
4. Check service logs: Look for health check related errors

**Common Issues**:
- **Health check timeout**: Timeout too short, database/Redis slow
- **Health check failing**: Service not responding, dependency unavailable
- **Probe errors**: Incorrect probe configuration, service not ready

**Recovery Steps**:
1. Increase timeouts: Update `livenessProbe.timeoutSeconds` and `readinessProbe.timeoutSeconds` to 5s
2. Add internal timeouts: Add timeouts to database/Redis checks in health endpoint
3. Restart service: `kubectl -n off-campus-housing-tracker rollout restart deployment/<service>`
4. Monitor logs: Watch for health check improvements

### Emergency Recovery

**Complete Platform Reset** (use with extreme caution):
1. **Backup**: `./scripts/backup-now.sh`
2. **Scale down**: `kubectl -n off-campus-housing-tracker scale deployment --replicas=0 --all`
3. **Cleanup** (if safe): `kubectl -n off-campus-housing-tracker delete pods --all`
4. **Restart**: `./scripts/bootstrap-platform.sh`
5. **Restore**: `make pg.restore.dump`

**Quick Recovery**:
1. Restart all: `kubectl -n off-campus-housing-tracker rollout restart deployment --all`
2. Wait for ready: `kubectl -n off-campus-housing-tracker wait --for=condition=ready pod --all --timeout=300s`
3. Verify health: Run test script `./scripts/test-microservices-http2-http3.sh`

### Performance Troubleshooting

**Slow Queries**:
1. Check database logs: Look for slow query logs
2. Check connection pools: Verify pool sizes and usage
3. Check indexes: Verify indexes exist for query patterns
4. Check query plans: Use `EXPLAIN ANALYZE` for slow queries

**High Memory Usage**:
1. Check resource limits: `kubectl -n off-campus-housing-tracker describe pod <pod> | grep -A 5 "Limits\|Requests"`
2. Check memory leaks: Monitor memory usage over time
3. Check connection pools: Too many connections can cause high memory
4. Check caching: Verify Redis cache is working correctly

**High CPU Usage**:
1. Check CPU limits: Verify CPU requests/limits are appropriate
2. Check query performance: Slow queries can cause high CPU
3. Check worker threads: Verify thread pool sizes
4. Check load: Verify if load is expected or abnormal

## Auction Monitor Data Pipeline Architecture

### Overview

The Auction Monitor service implements a comprehensive data pipeline for ingesting, normalizing, validating, and storing auction listings from multiple platforms (eBay, Discogs, Buyee, YahooJP, CarousellHK, RecordCity). The pipeline ensures data quality before feeding into Analytics Service and Python AI Service.

**Key Features**:
- **Granular Percentiles (p1-p99)**: Calculates every percentile from p1 to p99 (not just p25, p50, p75, p95) for precise price positioning and better AI predictions
- **Discogs Price History**: Browser automation for full sales arc scraping (not just low/median/high)
- **Service Integrations**: Provides price analytics to Social Service (negotiation assistance), Shopping Service (buyer evaluation), and Listings Service (seller optimization)
- **Data Quality Engine**: Multi-factor confidence scoring (0.0-1.0) with enrichment bonuses
- **Comprehensive Documentation**: See `services/auction-monitor/SERVICE_INTEGRATIONS.md` for complete integration details

### Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              Platform Adapters (Extract Layer)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   eBay API   │  │ Discogs API  │  │  Buyee       │        │
│  │  (Official)  │  │  (Official)  │  │  (Scraping)  │        │
│  │              │  │              │  │  Puppeteer   │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  YahooJP     │  │ CarousellHK  │  │ RecordCity   │        │
│  │  (Scraping)  │  │  (Scraping)  │  │  (Multi-Region)│       │
│  │  Puppeteer   │  │  Puppeteer   │  │  Puppeteer   │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                                 │
│  Rate Limiting: Redis Lua scripts (token-bucket, sliding-window)│
│  Caching: Redis with Lua singleflight (prevents thundering herd)│
│  Browser Pool: Puppeteer browser instance management            │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Data Normalizer (Transform Layer)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  - Schema Mapping: Platform-specific → Unified schema         │
│  - Field Normalization: Currencies, conditions, formats, URLs │
│  - Price Conversion: Multi-currency support                   │
│  - Proxy Fee Calculation: Buyee/YahooJP total cost            │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Validation Engine (Quality Layer)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  - Required Fields: Title, price, URL, external ID            │
│  - Data Types: Numeric validation, URL validation            │
│  - Business Rules: Price ranges, date validation              │
│  - Completeness Scoring: 0.0-1.0 based on field population   │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Staging Pipeline (Load Layer)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Store Raw: auction_monitor.raw_listings                   │
│  2. Normalize: Platform-specific → Unified schema             │
│  3. Validate: Required fields, data types, business rules     │
│  4. Deduplicate: Exact match, URL match, fuzzy matching       │
│  5. Enrich: Discogs catalog matching (future)                 │
│  6. Score Confidence: Multi-factor (0.0-1.0)                  │
│  7. Store Normalized: Only if valid & confidence ≥ 0.5        │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              PostgreSQL (Staging & Normalized)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  raw_listings: Raw platform data, validation status          │
│  normalized_listings: Unified schema, confidence scores       │
│  price_history: Time-series price snapshots                   │
│  user_watches: User-defined search criteria                   │
│  watch_matches: Listings matching user watches                │
│  platform_health: Platform availability monitoring            │
│  data_quality_metrics: Quality tracking per platform          │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Analytics Service Integration                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  - Ingests from normalized_listings (confidence ≥ 0.7)        │
│  - **Granular percentile calculation (p1-p99)** - every percentile│
│  - Historical comparison and trend analysis                   │
│  - **Discogs price history integration** (full sales arc)     │
│  - Time-series storage for price snapshots                    │
│  - **Service integrations**: Social, Shopping, Listings        │
└──────────────────────────────────────┬──────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              Python AI Service Integration                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  - Consumes clean, validated data from Analytics Service       │
│  - ML models trained on high-quality data (confidence ≥ 0.7)  │
│  - **Uses granular percentiles (p1-p99)** for precise analysis│
│  - Price predictions, deal detection, recommendations         │
│  - **Service integrations**: Social (negotiation), Shopping (evaluation), Listings (optimization)│
│                                                                 │
│  **Platform-Wide Business Intelligence Use Cases**:            │
│  - **Seller Intelligence**: Auction starting bid, OBO flexibility, fixed price optimization│
│  - **Buyer Intelligence**: Price evaluation, negotiation assistance, deal detection│
│  - **Social Integration**: Negotiation assistance for both buyers and sellers│
│  - **Shopping Integration**: Buyer evaluation and seller optimization│
│  - **Kafka Pipeline**: Real-time data flow from Analytics → Python AI│
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

#### 1. Two-Stage Storage (Raw → Normalized)

**Decision**: Store raw platform data separately from normalized data.

**Rationale**:
- **Reprocessing**: Raw data can be reprocessed if normalization logic changes
- **Debugging**: Original platform data preserved for troubleshooting
- **Quality Analysis**: Compare raw vs normalized to identify data quality issues
- **Audit Trail**: Complete history of data transformations

**Implementation**:
- `raw_listings`: Stores original JSONB data from platforms
- `normalized_listings`: Stores unified schema with validation results
- Foreign key relationship: `normalized_listings.raw_listing_id → raw_listings.id`

#### 2. Redis Rate Limiting with Lua Scripts

**Decision**: Use Redis Lua scripts for atomic rate limiting operations.

**Rationale**:
- **Atomic Operations**: Lua scripts execute atomically, preventing race conditions
- **Distributed Rate Limiting**: Works across multiple service instances
- **Multiple Strategies**: Token bucket, sliding window, fixed window
- **Performance**: Single round-trip to Redis per rate limit check

**Implementation**:
- **Token Bucket**: Refills tokens at a constant rate, allows bursts
- **Sliding Window**: Tracks requests in a rolling time window
- **Fixed Window**: Simple counter per time window
- **Platform-Specific**: Each platform has its own rate limit configuration

**Example**:
```typescript
// eBay: 5000 requests/day (token bucket)
await rateLimiter.acquire('ebay', {
  requests: 5000,
  window: '24h',
  strategy: 'token-bucket'
})

// Buyee: 1 request/2s (fixed window)
await rateLimiter.acquire('buyee', {
  requests: 1,
  window: '2s',
  strategy: 'fixed-window'
})
```

#### 3. Redis Caching with Lua Singleflight

**Decision**: Implement singleflight pattern using Lua scripts to prevent thundering herd.

**Rationale**:
- **Thundering Herd Prevention**: Only one request fetches data, others wait for result
- **Cache Stampede Prevention**: Prevents multiple simultaneous cache misses
- **Atomic Lock Management**: Lua scripts ensure atomic lock acquisition/release
- **Fail-Open**: Falls back to direct fetch if Redis is unavailable

**Implementation**:
- **Lock Acquisition**: First request acquires lock, fetches data
- **Wait Pattern**: Other requests wait for data to be set (polling)
- **Lock Release**: Data setter releases lock atomically
- **Timeout Handling**: Waits up to 10 seconds, then fetches directly

**Example**:
```typescript
// Multiple requests for same data
const data = await cache.getOrSet(
  'ebay:search:beatles',
  async () => {
    // Only one request executes this
    return await ebayAdapter.search({ query: 'beatles' })
  },
  { ttl: 300 }  // Cache for 5 minutes
)
```

**Lua Script Flow**:
1. Check if data exists → Return if cache hit
2. Try to acquire lock → If acquired, return "LOCK_ACQUIRED"
3. If lock exists → Return "LOCK_EXISTS" (client-side polling)
4. Lock holder fetches data → Sets data and releases lock
5. Waiting requests → Poll for data, return when available

#### 4. Browser Pool Management

**Decision**: Reuse Puppeteer browser instances instead of creating new ones per request.

**Rationale**:
- **Performance**: Browser startup is expensive (~2-3 seconds)
- **Resource Efficiency**: Reuses browser instances across requests
- **Connection Limits**: Manages page count per browser
- **Error Recovery**: Automatically removes closed/disconnected browsers

**Implementation**:
- **Pool Size**: Configurable max browsers (default: 3)
- **Pages Per Browser**: Configurable max pages (default: 5)
- **Automatic Cleanup**: Removes disconnected browsers
- **Graceful Shutdown**: Closes all browsers on service shutdown

#### 5. Confidence Scoring

**Decision**: Multi-factor confidence score (0.0-1.0) to filter low-quality data.

**Rationale**:
- **Data Quality Gate**: Only high-confidence data (≥0.7) feeds to Analytics/AI
- **Source Reliability**: Official APIs (0.95) vs scraping (0.70-0.75)
- **Completeness**: Penalizes missing required/important fields
- **Freshness**: Penalizes stale data
- **Enrichment Bonus**: Rewards catalog number matches

**Factors**:
- **Completeness**: Percentage of required/important fields populated
- **Source Reliability**: Platform-specific reliability score
- **Validation Errors**: Penalty for each validation error
- **Warnings**: Smaller penalty for validation warnings
- **Enrichment**: Bonus for Discogs catalog matches (future)

**Thresholds**:
- **≥0.7**: High confidence, fed to Analytics Service (with granular percentiles p1-p99)
- **≥0.8**: Very high confidence, optimal for Python AI Service
- **0.5-0.7**: Medium confidence, stored but not analyzed
- **<0.5**: Low confidence, stored in raw_listings only

**Granular Percentiles**:
- **Implementation**: Calculates every percentile from p1 to p99 (not just p25, p50, p75, p95)
- **Benefits**: Precise price positioning, better negotiation guidance, accurate AI predictions
- **Storage**: All percentiles stored in `price_history.metadata` for detailed analysis
- **Price Position**: Calculates which percentile current price falls into (0.0-1.0)

### Platform-Specific Implementation

#### Official APIs (eBay, Discogs)

**Advantages**:
- High reliability (0.95 confidence)
- Structured data, easy to parse
- Rate limits documented
- No anti-bot measures

**Challenges**:
- API key management
- Rate limit compliance
- OAuth for user-specific data (eBay)

#### Web Scraping (Buyee, YahooJP, CarousellHK, RecordCity)

**Advantages**:
- Access to platforms without APIs
- Can extract additional data not in APIs

**Challenges**:
- HTML structure changes break scrapers
- Anti-bot measures (CAPTCHAs, rate limiting)
- Lower reliability (0.70-0.75 confidence)
- Requires browser automation (Puppeteer)

**Mitigation**:
- **Rate Limiting**: Respectful scraping (1-2 requests/second)
- **Error Handling**: Graceful degradation, retry logic
- **Monitoring**: Track scraping success rates
- **Browser Pool**: Efficient resource usage

### Data Quality Metrics

**Tracking**:
- Total ingested vs validated listings per platform
- Average confidence and completeness scores
- Duplicate detection rates
- Enrichment rates (catalog number matches)
- Platform health (uptime, response times)

**Alerting**:
- Low confidence scores (<0.7 average)
- High failure rates (>10%)
- Platform downtime
- Data quality degradation

### Performance Optimizations

1. **Redis Caching**: Reduces redundant API calls and scraping
2. **Browser Pool**: Reuses expensive browser instances
3. **Rate Limiting**: Prevents platform blocking
4. **Batch Processing**: Processes multiple listings in parallel
5. **Database Indexes**: Fast lookups for deduplication and matching

### Service Integrations

**Social Service Integration**:
- **Negotiation Assistance**: Price context (granular percentiles p1-p99) for buyer/seller negotiations
- **Mood Analysis**: Python AI analyzes negotiation mood based on price position
- **Bigger Context**: Market trends, new drops detection
- **API Endpoints**: `GET /analytics/price-percentiles`, `POST /python-ai/negotiation-assist`
- **Example**: Buyer offers $45, system shows it's at p25 (good deal), suggests seller might accept $47-48 (p50-p60 range)

**Shopping Service Integration**:
- **Buyer Evaluation**: Price assessment using granular percentiles (p1-p99)
- **Negotiation Suggestions**: OBO (or best offer) recommendations based on percentile position
- **Auction Temperature**: Bid activity analysis, watcher count, time remaining
- **API Endpoints**: `GET /analytics/evaluate-price`, `GET /analytics/auction-temperature`
- **Example**: Item at $50 (p60), system suggests negotiating to $45-48 range with 65% success probability

**Listings Service Integration**:
- **Seller Optimization**: Pricing guidance using granular percentiles (p1-p99)
- **Listing Recommendations**: Title, description, photo suggestions based on successful listings
- **Price Positioning**: Optimal listing price based on percentile analysis
- **API Endpoints**: `GET /analytics/pricing-guidance`, `GET /analytics/successful-listings`, `POST /python-ai/optimize-listing`
- **Example**: Seller lists at $60 (above p75), system recommends $48 (p50) for better visibility

**Complete Integration Documentation**: See `services/auction-monitor/SERVICE_INTEGRATIONS.md` for detailed API specifications, example flows, and implementation status.

### Recent Enhancements

1. ✅ **Granular Percentiles**: p1-p99 calculation (replaces coarse p25/p50/p75/p95)
2. ✅ **Discogs Price History**: Browser automation for full sales arc (not just low/median/high)
3. ✅ **Service Integrations**: Social, Shopping, Listings service integration documentation
4. ✅ **Data Quality Engine**: Multi-factor confidence scoring with enrichment bonuses

### Future Enhancements

1. **Service Integration Endpoints**: Implement APIs for Social, Shopping, Listings services
2. **CAPTCHA Automation**: Integration with automated CAPTCHA solving services
3. **Additional Platforms**: Buyee, YahooJP, CarousellHK, RecordCity adapters
4. **Proxy Rotation**: Rotate IP addresses for scraping
5. **Machine Learning**: ML-based confidence scoring
6. **Real-Time Updates**: WebSocket/SSE for live price updates

## Future Enhancements

### Planned Improvements

1. **Service Mesh**: Full Linkerd integration for mTLS and traffic management
2. **Multi-Region**: Geographic distribution for lower latency
3. **GraphQL API**: Alternative to REST/gRPC for flexible queries
4. **Event Sourcing**: Complete audit trail of all changes
5. **CQRS**: Separate read/write models for better scalability
6. **Centralized Logging**: ELK stack or Loki for log aggregation
7. **Advanced Caching**: Multi-level caching with CDN integration
8. **API Versioning**: Support multiple API versions simultaneously

### Scalability Considerations

**Horizontal Scaling**:
- All services stateless (except database connections)
- Easy to scale with Kubernetes replicas
- Database read replicas for read-heavy workloads

**Vertical Scaling**:
- Resource requests/limits per service
- Database connection pool tuning
- Redis memory optimization

---

For questions or contributions, see [`README.md`](README.md) or open an issue.

