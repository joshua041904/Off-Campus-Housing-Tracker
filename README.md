# Off-Campus-Housing-Tracker

**TL;DR:** README is the fast path. Everything long-form lives under **`docs/`**.

---

## Quick start (do this first)

```bash
# 1. Build images once (dev-onboard does not build them for you)
make images

# 2. Full local stack (~20–28 min first time; see docs/DEV_ONBOARDING.md)
#    dev-onboard: pnpm deps → dev-root CA → cluster (up-fast) → Kafka TLS → sync+verify och-kafka-ssl-secret → deploy
RESTORE_BACKUP_DIR=latest make dev-onboard   # restore newest Postgres backups; or: make dev-onboard (no restore)
```

**Prereqs:** Colima (or k3s) + Docker, **pnpm** (see root `packageManager`), **kubectl** pointed at the cluster (`export KUBECONFIG="$HOME/.colima/default/kubeconfig"` or `make kubeconfig-colima`).

After workloads apply, sanity-check: `kubectl get pods -n off-campus-housing-tracker`. **`ImagePullBackOff`** / **`ErrImageNeverPull`** means build or load images (`make images` or per-service rebuild below).

**Daily development** (fast loop — you do **not** re-run full onboard for every change):

```bash
pnpm run rebuild:service:<name>    # see table below
kubectl rollout restart deployment/<deployment> -n off-campus-housing-tracker
```

The **`pnpm`** shortcuts rebuild the image and roll the Deployment. If you only changed code already in the image, a **`rollout restart`** alone is enough.

| `pnpm` shortcut | Kubernetes deployment |
|-----------------|-------------------------|
| `pnpm run rebuild:service:analytics` | `analytics-service` |
| `pnpm run rebuild:service:auth` | `auth-service` |
| `pnpm run rebuild:service:booking` | `booking-service` |
| `pnpm run rebuild:service:cron` | `cron-jobs` (if that Deployment exists in your cluster) |
| `pnpm run rebuild:service:listings` | `listings-service` |
| `pnpm run rebuild:service:media` | `media-service` |
| `pnpm run rebuild:service:messaging` | `messaging-service` |
| `pnpm run rebuild:service:notification` | `notification-service` |
| `pnpm run rebuild:service:search` | `listings-service` (search workloads) |
| `pnpm run rebuild:service:trust` | `trust-service` |
| `pnpm run rebuild:service:watchdog` | `transport-watchdog` (sidecar / gateway pairing; see script header) |
| `pnpm run rebuild:gateway:rollout` | `api-gateway` |

**Event-layer verification** is test-only (`pnpm run test:event-layer` / Vitest); there is no service image. **Anything else** with a **`services/<name>/Dockerfile`:** `SERVICES=<name>` **`bash scripts/rebuild-och-images-and-rollout.sh`** (comma- or space-separated list supported).

**Webapp + multiple services:** `./scripts/rebuild-housing-colima.sh` or `pnpm run rebuild:housing:colima` (see **docs/LOCAL_DEV.md** if needed).

---

## What this system is

Kubernetes-native, **event-driven** platform for off-campus housing: **listings, booking, messaging, notifications, trust, analytics, and media**, fronted by **api-gateway** and the **webapp** (nginx), with **domain-isolated Postgres** per service (no shared app DB across domains).

- **Edge:** Caddy (HTTP/3), Envoy (gRPC), ingress-nginx — **strict TLS**, local hostname **`https://off-campus-housing.test`** (MetalLB + `/etc/hosts`; see **`make ensure-edge-hosts`**).
- **Messaging:** **Kafka** — 3-broker **KRaft**, TLS/mTLS on the main dev path.
- **Data plane (local typical):** Postgres per service, Redis, MinIO; automation via **Makefile** + **`scripts/`**.

Protocol-aware traffic (**HTTP/1.1, HTTP/2, HTTP/3**) is a first-class testing concern (k6, Playwright, strict-canonical flows).

---

## Dev workflow

| When | What |
|------|------|
| First machine / cold cluster | `make images` then `RESTORE_BACKUP_DIR=latest make dev-onboard` |
| Stuck or flaky onboard | **docs/DEV_ONBOARDING_FAILURE_MODES.md** |
| Day to day | `pnpm run rebuild:service:…` and/or `kubectl rollout restart …` |

---

## Validation

```bash
make strict-canonical
make test
```

**`make test`** runs the workspace test set (gateway, services, cron-jobs, event-layer verification, etc.). For browser E2E and heavier gates, see **`package.json`** scripts (`test:webapp:e2e`, `preflight-and-suites`, …).

**Architecture docs (C4, UML, ER, diagrams):** `make generate-architecture` **clears then refills** **`diagrams/data-modeling/png/`** (Graphviz + PlantUML; class diagrams document **proto/RPC** surfaces). Narrative in **`docs/architecture/architecture.md`** and **`docs/architecture-book/`**. For rubric **§2.1** (one zip-ready folder: PNG + XMI + class XML + write-up): `make bundle-2.1-submission` → **`docs/architecture-submission/2.1-architecture-diagram/`** (includes **`domain.png`** and **all `physical-*.png`** when Postgres is up during generation).

---

## What makes this repo different (high level)

- Deterministic **make dev-onboard** path (KRaft, TLS guards, edge checks — details in **docs/DEV_ONBOARDING.md**).
- **Kafka quorum + TLS** as part of the default local story, not an afterthought.
- **Protocol and performance** tooling (k6, CSV/report flows, CI guards) wired through the Makefile and docs.

---

## Documentation

| Topic | Location |
|-------|----------|
| Architecture & service ownership | [docs/DESIGN.md](docs/DESIGN.md) |
| Engineering deep dive | [ENGINEERING.md](ENGINEERING.md) |
| Full local onboarding | [docs/DEV_ONBOARDING.md](docs/DEV_ONBOARDING.md) |
| Onboard failure modes | [docs/DEV_ONBOARDING_FAILURE_MODES.md](docs/DEV_ONBOARDING_FAILURE_MODES.md) |
| DB layout, ER diagrams, EXPLAIN samples | [docs/DB_SCHEMA_ER_AND_QUERY_PLANS.md](docs/DB_SCHEMA_ER_AND_QUERY_PLANS.md) |
| TLS & local testing | [docs/LOCAL_TLS_AND_TESTING_GUIDE.md](docs/LOCAL_TLS_AND_TESTING_GUIDE.md) |
| Pipeline order | [docs/RUN_PIPELINE_ORDER.md](docs/RUN_PIPELINE_ORDER.md) |
| Makefile / demo flows | [docs/MAKE_DEMO.md](docs/MAKE_DEMO.md) |
| gRPC handlers | [docs/GRPC_ONBOARDING.md](docs/GRPC_ONBOARDING.md) |
| CA rotation | [docs/CA_ROTATION_AND_CLIENT_TRUST.md](docs/CA_ROTATION_AND_CLIENT_TRUST.md) |

**More:** browse **`docs/`** — design notes, runbooks, perf write-ups.

---

## Useful Makefile targets

| Command | Purpose |
|---------|---------|
| `make help` | All targets with `##` descriptions |
| `make menu` | Short curated menu |
| `make verify` | Kafka cluster + edge routing checks |
| `make diagnose` | Narrower diagnostics |

Full preflight / suite driver (optional, heavy): **`pnpm preflight-and-suites`** or **`bash scripts/run-preflight-scale-and-all-suites.sh`**.

---

## Philosophy

Pay the complexity **once** during onboarding so day-to-day service work stays a tight **rebuild + rollout** loop. **README = entry point; `docs/` = depth.**
