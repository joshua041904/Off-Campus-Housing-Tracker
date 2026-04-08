# Onboarding readiness audit (repo facts)

Structured check: **does a clean clone + docs match what the scripts actually do?**  
Last reviewed: generated from Makefile + `scripts/dev-onboard-local.sh` + related paths.

## Summary

| Area | Status | Notes |
|------|--------|--------|
| Backend order (`make images` → `make dev-onboard`) | **PASS** | `dev-onboard` never calls `make images`; missing images → pull/mount failures on deploy. |
| Kafka hardened gates in local onboard | **PASS** | Phases include DNS, topic preflight, TLS guard (includes `verify-kafka-cluster`), quorum-stable, edge readiness, mounts check, and post-edge default **`KAFKA_ALIGNMENT_TEST_MODE=1 make kafka-alignment-suite`** (full alignment; **`DEV_ONBOARD_KAFKA_ALIGNMENT_SAFE_ONLY=1`** → **`kafka-health`**; skippable via **`SKIP_KAFKA_HEALTH_ON_ONBOARD`**). |
| DB bootstrap / restore | **PASS with nuance** | Restore vs SQL bootstrap depends on `RESTORE_BACKUP_DIR` (see below). |
| Frontend (`pnpm --filter webapp`) | **PASS** | Next.js; not Vite — no `VITE_*`. |
| Docs vs script default for restore | **FIXED** | Script used `export RESTORE_BACKUP_DIR="${RESTORE_BACKUP_DIR:-latest}"`, so an empty value from **`make dev-onboard`** still forced **`latest`**. Default export **removed** — empty **`RESTORE_BACKUP_DIR`** skips Phase-0 restore; set **`=latest`** explicitly when you want dumps. |

**Risk level:** **Low–Moderate** (Colima/MetalLB/Docker prerequisites; `deploy-dev.sh` uses `|| true` on some applies — see footguns).

---

## 1. Backend onboarding

### Required commands (documented)

1. `make images` — builds `HOUSING_DOCKER_SERVICES_DEFAULT` (`auth-service`, `listings-service`, … `api-gateway`, `transport-watchdog`) as `:dev`, loads into Colima when Colima is up.
2. `RESTORE_BACKUP_DIR=latest make dev-onboard` — when you want the newest `backups/` restore for Postgres.  
   `make dev-onboard` alone — **no** Phase-0 restore (empty DB / SQL bootstrap path).

### Does `dev-onboard` depend on images existing?

**YES.** It applies Deployments expecting images such as `auth-service:dev` (imagePullPolicy typically Never/local). **No pre-flight `docker image inspect`** — failure surfaces as pod events (`ErrImageNeverPull`, `ImagePullBackOff`).

### Does it fail if images missing?

**Eventually YES** (rollout/smoke/health), but **not** at a single dedicated “images missing” gate. README already warns about `ImagePullBackOff`.

### Kafka: topics, TLS, checks — skipped?

**NO** for the scripted local path (`scripts/dev-onboard-local.sh`):

| Phase | What runs |
|-------|-----------|
| 2 | `kafka-onboarding-reset` |
| 3 | `apply-kafka-kraft` |
| 4 | `onboarding-kafka-preflight` → cleanup jobs, `verify-kafka-dns`, `preflight-kafka-k8s` (**creates event topics** via `create-kafka-event-topics-k8s.sh`), `verify-kafka-bootstrap` |
| 5 | `kafka-tls-guard` → includes **full `verify-kafka-cluster`** (per Makefile target comment + script) |
| 5a–5a2 | cluster secrets, `service-tls-alias-guard`, `kafka-quorum-stable` |
| 5b | deferred TLS rollouts |
| 6 | `deploy-dev.sh` (strict envelope skipped with `SKIP_STRICT_ENVELOPE=1`) |
| 6b | optional client mount check via `verify-kafka-cluster.sh` |
| 7–9 | Caddy IP, `edge-readiness-gate`, `ensure-edge-hosts`, `onboarding-edge` |
| 10 | Default: **`KAFKA_ALIGNMENT_TEST_MODE=1 make kafka-alignment-suite`** (full alignment; Makefile runs **`kafka-auto-heal-inter-broker-tls`** first). **`DEV_ONBOARD_KAFKA_ALIGNMENT_SAFE_ONLY=1`** → **`make kafka-health`**. Skipped when **`SKIP_KAFKA_HEALTH_ON_ONBOARD=1`**. |

Script uses **`set -euo pipefail`** — a failing `make` sub-step aborts onboard.

### Prisma / DB migrations

- **Host Postgres:** `bootstrap-all-dbs.sh` applies **ordered SQL** under `infra/db/` (not Prisma CLI in that script). Auth notes Prisma/restore in comments.
- **In-cluster:** schema lifecycle depends on service images + env; onboard does **not** run `prisma migrate deploy` as a single explicit gate in `dev-onboard-local.sh`.
- **Restore path:** Phase 0 uses `bring-up-external-infra.sh` with `SKIP_BOOTSTRAP=1` when restoring from dumps.

### Certs / TLS

Generated and wired through **`make up`** chain (`tls-first-time`, `generate-canonical-dev-tls.sh`, Kafka JKS refresh after LB, etc.). Not skipped in the strict local script.

### Ports (representative)

- **api-gateway (internal rewrite target):** `4020` (see `webapp/next.config.mjs` `API_GATEWAY_INTERNAL`).
- **Postgres (compose):** 5441–5448 (documented in bootstrap scripts).
- **Webapp dev:** `3000`.

---

## 2. Frontend onboarding

| Check | Result |
|-------|--------|
| Commands valid | **YES** — `pnpm --filter webapp` matches workspace package `name: webapp`. |
| Requires backend | **Partially** — UI loads; **auth/API flows need gateway** (default rewrites to `http://127.0.0.1:4020`). |
| `VITE_API_URL` | **N/A** — Next.js app; use `NEXT_PUBLIC_API_BASE` only if bypassing rewrites. |
| `.env` required | **NO** for default local (rewrites to gateway). |
| Proxy | **YES** — `next.config.mjs` rewrites `/api/*` → `API_GATEWAY_INTERNAL`. |

---

## 3. Footguns (fresh machine)

| Item | Severity |
|------|----------|
| **Docker + Colima/k3s** | **Required** — no cluster → `kubectl` steps fail. |
| **`kubectl` context** | **Required** — `deploy-dev.sh` exits if no current context. |
| **MetalLB / LoadBalancer** | **Required** for edge path (Caddy IP, hosts). |
| **macOS `sudo` for `/etc/hosts`** | **Common** — `HOSTS_AUTO=1` appends/updates hosts. |
| **Docker login** | **Not required** for local `:dev` images (no registry push in `make images`). |
| **First-run time** | **~20–30+ min** (cluster, TLS, Kafka quorum, rollouts) — docs ballpark is reasonable. |
| **`deploy-dev.sh` `kubectl apply ... \|\| true`** | **Moderate** — can hide apply failures; onboard still may fail later on rollouts/smoke. |

---

## 4. Suggested improvements (optional)

1. **Pre-flight images:** optional `make` target or start of `dev-onboard-local.sh`: check one `:dev` image exists → clear message “run `make images`”.
2. **`deploy-dev.sh`:** reduce `|| true` on kustomize apply for stricter fail-fast (trade-off: flaky CRD ordering).
3. **Single `docker info` / `kubectl version --client` check** at start of onboard (user suggestion) — improves error messages.

---

## 5. PASS/FAIL checklist

- **Images before onboard documented:** PASS  
- **Kafka gates not skipped on local onboard:** PASS  
- **Topics created in preflight:** PASS  
- **TLS + quorum gates present:** PASS  
- **Frontend commands + API wiring:** PASS  
- **Restore default vs docs:** **FIXED** in `dev-onboard-local.sh` (removed forced default to `latest`).

---

## 6. What teammates should run (canonical)

```bash
# Backend (repo root)
make images
RESTORE_BACKUP_DIR=latest make dev-onboard   # or: RESTORE_BACKUP_DIR= make dev-onboard

# Frontend (repo root)
pnpm install
pnpm --filter webapp dev
# Production check (optional):
# pnpm --filter webapp build && pnpm --filter webapp start
```

Primary narrative doc: **`docs/DEV_ONBOARDING.md`** and **`webapp/README.md`**.
