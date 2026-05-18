# Build, install, and local deployment

**Full lab (canonical):** from repo root, **`COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/all-8-20260517-152701 make cold-bootstrap`** (or unset **`RESTORE_BACKUP_DIR`** to use **`COLD_BOOTSTRAP_DEFAULT_RESTORE`**, same pin). See **[README.md](README.md#full-local-stack-canonical)**. **Incremental:** **`make dev`** (**`scripts/dev-up.sh`** → **`scripts/dev-orchestrator.sh`** → **`scripts/dev-health-check.sh`**, **`bench_logs/dev-state.json`**), edge **`off-campus-housing.test`**.

This file is the **under-the-hood** reference: prerequisites, restore flags, fast paths, teardown, and legacy **`make dev-onboard`**.

Long-form narrative and failure modes: **[docs/DEV_ONBOARDING.md](docs/DEV_ONBOARDING.md)**, **[docs/DEV_ONBOARDING_FAILURE_MODES.md](docs/DEV_ONBOARDING_FAILURE_MODES.md)**.

---

## Under the hood (`make dev` / `dev-up.sh`)

1. **`scripts/dev-orchestrator.sh`** — Phase 0: Node ≥ 20, pnpm, Colima + Docker context + kubeconfig; optional **`TEST_BREAK_DOCKER`**; Phase 1: **`bring-up-external-infra.sh`** (Compose Postgres/Redis/MinIO; honors **`RESTORE_BACKUP_DIR`**); Phase 2: **`make deps`**; Phase 3: zero-trust CA + leaf TLS checks for **`off-campus-housing.test`**; Phase 4: **`make images`** (skippable via **`SKIP_BUILD`** / **`DEV_UP_SKIP_RECENT_IMAGE_BUILD`**); Phases 5–10: **`dev-onboard-from-up-fast.sh`** (cluster, Kafka, deploy, observability stack wait, edge, alignment).
2. **`scripts/dev-health-check.sh`** — `docker ps` sanity for Postgres/Redis, **`curl` `https://off-campus-housing.test/api/readyz`**, Jaeger ready, **`ensure-strict-tls-mtls-preflight.sh`**, **`make verify-kafka-bootstrap`**.
3. **`bench_logs/dev-state.json`** — small snapshot for troubleshooting.

**Postgres:** By default, **`make dev`** (via **`dev-up.sh`**) sets **`RESTORE_BACKUP_DIR=latest`** when **`backups/all-8-*`** or **`all-7-*`** exists so **`infra-cluster`** uses dump restore only (no **`infra/db`** SQL bootstrap). Pin a snapshot with **`RESTORE_BACKUP_DIR=backups/all-8-…`**. Opt out with **`DEV_UP_SKIP_AUTO_RESTORE=1`** to use infra SQL bootstrap from **`infra/db`**.

Tear down: **`DEV_DOWN_CONFIRM=yes make dev-down`**. Hard reset (including compose volumes): **`DEV_RESET_CONFIRM=yes make dev-reset`** (optional **`DEV_RESET_CLEAR_BENCH_LOGS=1`**).

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|--------|
| **macOS or Linux** | arm64/x64 per root `package.json` `supportedArchitectures`. |
| **Node.js ≥ 20** | Root `engines.node` and `.nvmrc`. Use `nvm`, `fnm`, or `brew` so `node -v` is 20+. |
| **pnpm** | Version pinned via `packageManager` in `package.json` (e.g. `pnpm@9.11.0`). Corepack: `corepack enable && corepack prepare pnpm@9.11.0 --activate`, or install pnpm globally. **`make deps` fails fast if `pnpm` is missing.** |
| **Docker** | **Colima + Kubernetes** is the primary local path (`colima start --with-kubernetes`). Docker Desktop can work but the repo assumes Colima’s daemon for image build/load; align context per **`scripts/lib/ensure-colima-docker-context.sh`** if you see socket/context drift. |
| **kubectl** | Must talk to your cluster. Colima: `export KUBECONFIG="$HOME/.colima/default/kubeconfig"` or **`make kubeconfig-colima`** (prints hint). |
| **jq** | Used by onboarding, phase barriers, and many scripts. `brew install jq` / distro package. |
| **openssl**, **curl ≥ 8.19.0 + HTTP/3** | TLS and edge checks; preflight and **`make deps`** run **`scripts/check-curl-preflight-reqs.sh`**. macOS: **`brew install curl`** and **`export PATH="/opt/homebrew/opt/curl/bin:$PATH"`** (Apple Silicon) or **`/usr/local/opt/curl/bin`** (Intel). Diagnose: **`./scripts/verify-curl-http3.sh`**. |
| **Python 3** | Some verify steps (e.g. `och-kafka-ssl-secret` checks in `scripts/dev-onboard-local.sh`). |
| **RAM / disk** | First onboard: multiple Postgres instances, three Kafka brokers, images — allow **~8 GB+ RAM** and **~20–30 minutes**. |

Optional but common:

- **Playwright Chromium**: installed by **`make deps`** (`pnpm --filter webapp exec playwright install chromium`).
- **macOS keychain**: host **k6** / Go TLS for `https://off-campus-housing.test` uses the login keychain, not only `SSL_CERT_FILE`. See **Runbook.md** (preflight / macOS CA) or `scripts/lib/trust-dev-root-ca-macos.sh`.

---

## 2. `make dev` vs `make dev-onboard`

Use **`make dev`** ( **`scripts/dev-up.sh`** → orchestrator + health). It includes **`make images`** unless skipped.

**`make dev-onboard`** is **legacy**: same broad outcome but **does not** run **`make images`** and uses **`scripts/dev-onboard-local.sh`** (explicit Phase 0 → 0.25 → 0.5 → tail). Prefer **`make dev`** with **`RESTORE_BACKUP_DIR=latest`** when you want one command including images: orchestrator runs **`bring-up-external-infra.sh`** (restore) **before** **`make deps`**.

---

## 3. First-time flow (minimal)

```bash
make dev
# Optional restore from newest all-8 backup:
RESTORE_BACKUP_DIR=latest make dev
```

### Cold-start proof (destructive)

To prove **`make dev`** on a machine that has been forcibly reset (Colima stopped, Docker images pruned, `node_modules` removed, optional `certs/` moved), run the guarded script — **Phase B wipes local Docker images and stops Colima**:

```bash
COLD_START_CONFIRM=yes make test-dev-cold-start
# or: COLD_START_CONFIRM=yes ./scripts/test-dev-cold-start.sh
```

Optional: `COLD_START_RESET_CERTS=1` (with confirm) moves `certs/` into `bench_logs/` so the run exercises dev-root reissue. Logs: `bench_logs/dev-cold-start-pre.txt`, `dev-cold-start-post.txt`, `dev-cold-start-metrics.json`.

Failure injection (orchestrator must exit non-zero quickly): `make test-dev-orchestrator-docker-break`.

### Full-stack proof (cold start + preflight + artifact seal)

One guarded path: **`make test-dev-cold-start`** (with confirm), then **`make preflight-lab`**, then assert **`bench_logs/run-*`** artifacts exist. Fails at a single explicit guard if anything is missing.

```bash
FULL_STACK_PROOF_CONFIRM=yes make full-stack-proof
```

- Default: `SKIP_MACOS_DEV_CA_TRUST=1` inside the script (override with `SKIP_MACOS_DEV_CA_TRUST=0` if you need the macOS dev-root trust check).
- Optional: `FULL_STACK_PROOF_EXTRA_DEV_CYCLES=yes` runs `make dev` / `make dev-verify` twice after cold start (idempotency).
- Optional: `FULL_STACK_PROOF_REPEAT_PREFLIGHT=yes` runs **`make preflight-lab`** a second time.
- Summary: **`bench_logs/full-stack-proof-summary.txt`**.

**Makefile** also enforces **Node 20.x** (`.nvmrc`) via **`ensure-node20`** before **`make dev`**, **`make dev-verify`**, **`make preflight-strict`** / **`preflight-lab`**, **`make test-dev-cold-start`**, and **`make dev-onboard`**.

**Aliases:** `make setup` is the same as **`make dev`** (see Makefile).

After success:

```bash
kubectl get pods -n off-campus-housing-tracker
```

**`ImagePullBackOff` / `ErrImageNeverPull`**: cluster cannot see your `:dev` images → re-run **`make images`** with Docker pointed at Colima, then **`kubectl rollout restart deployment/<name> -n off-campus-housing-tracker`**.

---

## 4. Certificates and TLS (short)

- Local hostname: **`https://off-campus-housing.test`** (MetalLB + `/etc/hosts`; **`make ensure-edge-hosts`**).
- **dev-root** CA and leaf material live under **`certs/`** (gitignored private keys; never commit secrets). Preflight/onboarding scripts generate or refresh them as part of **`tls-first-time`** / **`generate-canonical-dev-tls.sh`** flows inside **`make up-fast`**.
- **Kafka**: JKS and **`och-kafka-ssl-secret`** are synchronized after KRaft apply and LB pins; see **docs/DEV_ONBOARDING.md** §0–12 and **Runbook.md** for strict TLS/mTLS and `dev-root-ca` in **`ingress-nginx`**.

If you only need cert semantics without full onboard: **Runbook.md** (TLS sections) and **ENGINEERING.md**.

---

## 5. Makefile targets (build / deploy subset)

| Target | When to use |
|--------|----------------|
| **`make deps`** | First clone and after `package.json`/lockfile changes. Installs pnpm deps + Playwright Chromium. |
| **`make images`** | Before first deploy; after Dockerfile or service code changes that affect images. |
| **`make images-all`** | Heavier: build all + rollouts (see Makefile `##`). |
| **`make dev`** | **Preferred** — `dev-up.sh` + orchestrator + `dev-health-check.sh` + `bench_logs/dev-state.json`. |
| **`make dev-onboard`** | Legacy full stack; restore-before-deps ordering; no `make images`. |
| **`make up` / `make up-fast`** | Lower-level stack pieces; **`dev-onboard`** wraps **`up-fast`** after Phase 0–0.5. |
| **`make kubeconfig-colima`** | Prints Colima kubeconfig hint. |
| **`make help`** | All documented targets. |

---

## 6. Optional tooling (not required for basic onboard)

- **Preflight lab**: `make preflight-lab` / strict variants — see Makefile and **Runbook.md**.
- **Host tools for transport studies**: **`scripts/install-preflight-tools.sh`** (curl HTTP/3, tcpdump, tshark, …).

---

## 7. Checklist (mental model)

- [ ] Node 20+, pnpm on PATH  
- [ ] Colima (or cluster) running; `kubectl` works  
- [ ] **`make dev`**  
- [ ] If using restore: **`backups/`** contains what **`RESTORE_BACKUP_DIR=latest`** resolves to  
- [ ] Pods `Running`; **`/etc/hosts`** for **off-campus-housing.test** if you hit TLS/DNS issues  

You are then in the same state described in **README.md** (service rebuilds + rollouts).
