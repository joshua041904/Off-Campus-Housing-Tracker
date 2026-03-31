# Off-Campus-Housing-Tracker

## Overview

**Off-Campus-Housing-Tracker** is a **Kubernetes-native**, event-driven platform for off-campus housing: listings, bookings, messaging, trust, and analytics. Local development targets **Colima + k3s**; the same patterns apply in-cluster with **Caddy**, **Envoy**, **ingress-nginx**, and **strict TLS** (including **Kafka mTLS** on the KRaft path).

Principles: event-driven architecture, domain-isolated data, horizontal scalability, no cross-domain database access, CI-first workflows. The layout is meant to be traceable end-to-end (edge TLS / HTTP/3 → gateway → gRPC and REST → Kafka and per-service databases → observability).

---

## Features

- **Listing search and discovery** — filters (price, distance, tags), geolocation, availability  
- **Booking lifecycle** — reservations, landlord approval, cancellation; payment hooks later  
- **Messaging** — conversations, messages, read receipts, attachments  
- **Notifications** — booking confirmations, reminders, price drops, reviews (Kafka-driven)  
- **Trust and safety** — reviews, ratings, abuse reports, moderation, listing flags  
- **Analytics** — event aggregation and insights off the request path  

---

## Documentation map

| What you need | Where |
|---------------|--------|
| **Domain model, decomposed architecture, service ownership, ports, runbook-style steps** | [**docs/DESIGN.md**](docs/DESIGN.md) |
| **Engineering decisions, security, IaC, deep architecture** | [**ENGINEERING.md**](ENGINEERING.md) |
| **gRPC handlers** | [**docs/GRPC_ONBOARDING.md**](docs/GRPC_ONBOARDING.md) |
| **Colima / MetalLB / `make demo`** | [**docs/MAKE_DEMO.md**](docs/MAKE_DEMO.md) |
| **TLS, certs, local testing** | [**docs/LOCAL_TLS_AND_TESTING_GUIDE.md**](docs/LOCAL_TLS_AND_TESTING_GUIDE.md) |
| **CA rotation** | [**docs/CA_ROTATION_AND_CLIENT_TRUST.md**](docs/CA_ROTATION_AND_CLIENT_TRUST.md) |
| **Full pipeline order** | [**docs/RUN_PIPELINE_ORDER.md**](docs/RUN_PIPELINE_ORDER.md) |
| **PR / review paste template (example)** | [`docs/PR_REVIEW_GRPC_HANDLER_PASTE.example.txt`](docs/PR_REVIEW_GRPC_HANDLER_PASTE.example.txt) |

---

## Build and run (Makefile)

Orchestration is in the [**Makefile**](Makefile). Default target: **`make menu`** (same as **`make`**).

### Prerequisites

- **Colima** (or another **k3s** / **kubectl** setup) and a Docker-compatible runtime  
- **Node** and **pnpm** (see root `package.json` → `packageManager`)  
- **kubectl** pointed at the cluster — on Colima after the cluster exists:  
  `export KUBECONFIG="$HOME/.colima/default/kubeconfig"`  
  (hint: **`make kubeconfig-colima`**)

### First-time bootstrap

1. Clone the repository and `cd` into it.  
2. Run **`make up`**.  
   Runs **`deps`** (`pnpm install`, Playwright Chromium), **`cluster`** (Colima + k3s + MetalLB pool from `METALLB_POOL`, default `192.168.64.240-192.168.64.250`), **`tls-first-time`** (CA/leaf, strict TLS bootstrap, Kafka JKS — broker certs merge **MetalLB** IPs for `kafka-*-external` when the API server is reachable), **`infra-host`** / **`infra-cluster`**, **`metallb-fix`**, **`hosts-sanity`**, **`preflight-gate`**, and related steps.  
   It does **not** run the long **`scripts/run-preflight-scale-and-all-suites.sh`** matrix by default.  
3. When the recipe finishes, use **`make strict-canonical`** or **`make test`** as prompted.

### Faster repeat runs

- **`make up-fast`** — same as **`make up`** but skips **`deps`** when dependencies are already installed.

### Discover commands

- **`make help`** — targets with `##` descriptions  
- **`make menu`** — short curated menu  

### Edge hostname and DNS

**Playwright**, **k6** edge scripts, and **`make verify-curl-http3`** expect **`https://off-campus-housing.test`**. Add the MetalLB (or edge) IP to **`/etc/hosts`**, or use **`OCH_EDGE_IP`** / **`OCH_AUTO_EDGE_HOSTS`** (see **`scripts/lib/edge-test-url.sh`**).  
**`kubectl port-forward` to api-gateway** is for debugging only — not for integrated E2E or **`scripts/run-housing-k6-edge-smoke.sh`**.

### Sanity checks (cluster up)

| Goal | Command |
|------|---------|
| Kafka KRaft + TLS + advertised listeners + quorum | **`make verify-kafka-cluster`** |
| Ingress **`/api`** + **`/auth`** → gateway, DNS→LB, curl health | **`make verify-preflight-edge-routing`** |
| Housing Kafka bootstrap seeds | **`make verify-kafka-bootstrap`** |
| k6 / edge debugging | **`make diagnose-k6-edge`** |

### Full preflight + test matrix

```bash
pnpm preflight-and-suites
# or
bash scripts/run-preflight-scale-and-all-suites.sh
```

See the script header for **`PREFLIGHT_*`**, **`RUN_SUITES`**, **`PREFLIGHT_APP_SCOPE`**, etc.

---

## Rebuilding images after code changes (Colima)

| You changed | Run |
|-------------|-----|
| **Webapp** (+ optional **listings-service**) | `./scripts/rebuild-housing-colima.sh` or **`pnpm run rebuild:housing:colima`** |
| **One backend** | **`pnpm run rebuild:service:<name>`** or `SERVICES=<name> ./scripts/rebuild-och-images-and-rollout.sh` |
| **Several backends** | `SERVICES="svc-a svc-b" ./scripts/rebuild-och-images-and-rollout.sh` |
| **Webapp + backends** | `SERVICES="listings-service auth-service" ./scripts/rebuild-housing-colima.sh` |

Webapp needs **`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`** from **`webapp/.env.local`** at build time (**`webapp/env.local.template`**). More detail: **`docs/WEBAPP_GOOGLE_MAPS_AND_DEPLOY.txt`**, **`GITHUB_ISSUES_EXECUTABLE.txt`**, **`GITHUB_PR_DESCRIPTION.txt`**.

---

## Contributing / technical depth

For **why** the stack is shaped this way (Caddy vs Envoy, Kustomize, observability, performance), read [**ENGINEERING.md**](ENGINEERING.md). For **what each service owns** and **architecture diagrams** (broken into layers), read [**docs/DESIGN.md**](docs/DESIGN.md).
