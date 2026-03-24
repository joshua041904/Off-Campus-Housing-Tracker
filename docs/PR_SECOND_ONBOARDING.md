# Second PR — Green team: cluster, databases, TLS/mTLS, curl, preflight

This document is the **onboarding runbook** for teammates who are new to the repo. It complements the **first PR** (features, review split, perf hooks):

- **First PR body (paste into GitHub):** repo root **`GITHUB_PR_DESCRIPTION.txt`** — **§4** is the canonical **first-time order** (`setup-new-colima-cluster.sh` → `bring-up-external-infra.sh` → TLS → `bring-up-cluster-and-infra.sh`), with **macOS, Linux, k3d**, and **Windows/WSL** called out in **§3**.
- **Short pointer:** **`docs/PR_FIRST_CONTRIBUTION.md`**

**This second PR** focuses on **how to get a machine from zero → Colima + k8s + external Postgres/Redis/Kafka + strict TLS + preflight passing**, without expecting prior knowledge of our CA bundle, JKS, or MetalLB. **k3d/Linux** devs skip Colima install and use **`REQUIRE_COLIMA=0`** for preflight; same Docker infra + TLS steps still apply.

---

## 0) What `run-preflight-scale-and-all-suites.sh` already does for you (certs)

You do **not** manually paste PEMs into the cluster for every run. Preflight **includes** automation that:

- Ensures housing TLS secrets when missing (**`scripts/ensure-housing-cluster-secrets.sh`**, step **3a0**).
- Runs **strict TLS/mTLS** checks and ordered rollouts (**`scripts/ensure-strict-tls-mtls-preflight.sh`**, step **5**).
- By default **`PREFLIGHT_REISSUE_CA=0`**: if **`service-tls`** + **`dev-root-ca`** already exist, it **skips** full CA rotation (faster, less churn). If secrets are **missing**, bootstrap/reissue still runs.

**But:** Kafka and Docker Compose expect **files on disk** under **`certs/`** and **`certs/kafka-ssl/`** *before* some services start. So you still follow **§4** once per machine (or after a clean wipe).

---

## 1) Prerequisites (tools)

| Tool | Why |
|------|-----|
| **Colima** + Docker | k3s + Docker Compose (Postgres, Redis, Kafka) |
| **kubectl** | Cluster operations |
| **OpenSSL** | CA / leaf material |
| **keytool** (JDK) | Kafka **JKS** (`kafka.keystore.jks`, `kafka.truststore.jks`) |
| **Node 20 + pnpm** | Service builds, Vitest in preflight |
| **k6** (optional) | Edge load grid in step 7a |
| **PostgreSQL client** (`psql`, `pg_restore` 16.x) | Backups / restores |

- **macOS:** Xcode CLT or Homebrew for most of the above.  
- **Linux:** Docker Engine + Compose plugin, distro or upstream packages for the rest; **Colima** optional ([Colima install](https://github.com/abiosoft/colima#installation)) or use **k3d** only.  
- **Windows:** use **WSL2** + Docker/Colima inside WSL; do not rely on host Windows Docker alone for these scripts unless you know the networking.

---

## 2) curl **8.19.0+** with HTTP/3 (host)

Apple’s `/usr/bin/curl` often **does not** support **`--http3`**. Preflight and HTTP/3 probes expect a **modern curl** on your **PATH**.

### Install (Homebrew)

```bash
brew install curl
```

Use the **keg-only** binary first on `PATH` (Apple Silicon typical path):

```bash
export PATH="/opt/homebrew/opt/curl/bin:$PATH"
hash -r
curl -V
```

You want **`curl` 8.19.0 or newer** with **HTTP/3** support (build often shows **ngtcp2** / **nghttp3** / **OpenSSL** in `curl -V`).

### Verify HTTP/3 flag

```bash
curl --help all 2>/dev/null | grep -E 'http3|http2' | head -5
./scripts/verify-curl-http3.sh
```

Add the `export PATH=...` line to **`~/.zshrc`** or **`~/.bash_profile`** so new terminals keep it.

**Related:** `scripts/ensure-ready-for-preflight.sh` tries to upgrade/check Homebrew curl (step 2).

---

## 3) One-shot: Colima + MetalLB + external infra + **latest DB backup**

From **repo root**, password default **`postgres`** unless you changed Compose.

### Recommended (single entrypoint)

Uses **`RESTORE_BACKUP_DIR=latest`** → newest **`backups/all-8-*`** or **`all-7-*`** (see **`backups/README.md`**).

```bash
cd /path/to/Off-Campus-Housing-Tracker
export PGPASSWORD=postgres

RESTORE_BACKUP_DIR=latest ./scripts/bring-up-cluster-and-infra.sh
```

What this runs (high level):

1. **`setup-new-colima-cluster.sh`** — Colima + k3s + MetalLB pool (script default **251–260**; adjust in script or env if your doc says otherwise).
2. **`bring-up-external-infra.sh`** — Zookeeper, Kafka (if JKS present), Redis, MinIO, **8 Postgres** on **5441–5448**, then optional **restore from backup**.
3. **`docker compose up -d`**
4. **`bootstrap-after-bring-up.sh`** — SQL under **`infra/db/`** + optional legacy auth dump
5. **`verify-bootstrap.sh`** + **`inspect-external-db-schemas.sh`**

**Pods** reach DBs via **`host.docker.internal:5441`…`5448`** — see Runbook if pods can’t connect.

### If the cluster already exists

```bash
RESTORE_BACKUP_DIR=latest SKIP_CLUSTER=1 ./scripts/bring-up-cluster-and-infra.sh
```

### Backup / restore reference

- **Backup all 8 DBs:** `PGPASSWORD=postgres ./scripts/backup-all-dbs.sh` → `backups/all-8-<timestamp>/`
- **Restore:** `RESTORE_BACKUP_DIR=latest` or `RESTORE_BACKUP_DIR=backups/all-8-<timestamp>` (see **`backups/README.md`**)

---

## 4) TLS / mTLS / **JKS** (first time or new laptop)

Follow the deep dive in **`docs/CERT_GENERATION_STRICT_TLS_MTLS.md`**. **Order matters.**

### Minimal sequence (clean slate)

```bash
cd /path/to/Off-Campus-Housing-Tracker

# 1) CA + leaf + cluster secrets (keep dev-root.key for next steps — KAFKA_SSL=1)
KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh

# 2) Envoy mTLS client cert → cluster
./scripts/generate-envoy-client-cert.sh
./scripts/strict-tls-bootstrap.sh

# 3) Kafka broker + client certs + JKS → certs/kafka-ssl/ + secret
./scripts/kafka-ssl-from-dev-root.sh
```

**Outputs you should see:**

| Path / secret | Role |
|----------------|------|
| **`certs/dev-root.pem`** | Trust anchor (k6 **`SSL_CERT_FILE`**, curl **`--cacert`**) |
| **`certs/kafka-ssl/*.jks`** + `client.crt` / `client.key` | Docker Kafka + **`kafka-ssl-secret`** |
| K8s **`service-tls`**, **`dev-root-ca`**, **`off-campus-housing-local-tls`**, **`envoy-client-tls`** | gRPC mTLS, Caddy, Envoy |

### macOS: trust dev CA for browser / some tools

```bash
./scripts/lib/trust-dev-root-ca-macos.sh certs/dev-root.pem
```

### `/etc/hosts`

Point the edge hostname at your **MetalLB** (or test) IP as documented in **`docs/CERTS_AND_TESTING_FOR_MORTALS.md`** / **`RUN-PREFLIGHT.md`**.

---

## 5) Apply Kubernetes apps + images

Preflight can build missing **`:dev`** images when **`PREFLIGHT_ENSURE_IMAGES=1`** (default). For a predictable first pass:

```bash
kubectl config use-context colima   # or your context
# apply base / overlay per your branch (example)
kubectl apply -k infra/k8s/base/...   # follow NEW_CLUSTER_SETUP or team doc
```

If **`ImagePullBackOff`**, build and load images (Colima):

```bash
docker build -t listings-service:dev -f services/listings-service/Dockerfile .
docker save listings-service:dev | colima ssh -- docker load
kubectl rollout restart deployment/listings-service -n off-campus-housing-tracker
```

See **`docs/RUN-PREFLIGHT.md`** (“Rebuild and deploy after code changes”).

---

## 6) Preflight gate: “ready?”

```bash
./scripts/ensure-ready-for-preflight.sh
```

Optional: **`./scripts/ensure-ready-for-preflight.sh --run`** to chain into preflight (uses your env).

This checks **API**, **Postgres 5441–5448**, **Kafka :29094**, **Redis**, and curl HTTP/3 hints.

---

## 7) Run **full preflight** (+ suites inside it)

**MetalLB + Colima** (typical dev):

```bash
METALLB_ENABLED=1 RUN_PGBENCH=0 ./scripts/run-preflight-scale-and-all-suites.sh \
  2>&1 | tee "bench_logs/preflight-$(date +%Y%m%d-%H%M%S).log"
```

- **`RUN_PGBENCH=0`** skips long step **8**; remove for full DB sweeps.
- **`RUN_FULL_LOAD=1`** enables heavier k6 phases + pgbench defaults (see script header).

**What runs inside** (abbreviated): API ready → optional CA reissue → MetalLB/Caddy → scale → **strict TLS/mTLS** → wait for pods → **run-all-test-suites** (auth, rotation, standalone capture, tls-mtls) → optional k6 phases → housing **Vitest** + **`test-microservices-http2-http3-housing.sh`** + **k6 edge grid** + Playwright (defaults on).

More detail: **`docs/RUN-PREFLIGHT.md`**, script header in **`scripts/run-preflight-scale-and-all-suites.sh`**.

---

## 8) Other test suites (outside or after preflight)

| Script | When |
|--------|------|
| **`scripts/run-all-test-suites.sh`** | Housing protocol suites only; can run full preflight first with **`SKIP_FULL_PREFLIGHT=0`** (default) or point at existing cluster |
| **`scripts/test-microservices-http2-http3-housing.sh`** | Also invoked from preflight **7a** |
| **`SSL_CERT_FILE=$PWD/certs/dev-root.pem ./scripts/run-housing-k6-edge-smoke.sh`** | k6 edge grid only |
| **`docs/perf/`** | **`run-perf-full-report.sh`**, isolation matrix, contention watch |

---

## 9) Troubleshooting (where to look)

| Symptom | Doc / action |
|---------|----------------|
| curl **60** / cert mismatch | Re-issue: **`KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh`**, restart Caddy |
| Kafka / messaging won’t start | **`certs/kafka-ssl`**, **`./scripts/kafka-ssl-from-dev-root.sh`**, **`kafka-ssl-secret`** |
| Envoy upstream errors | **`envoy-client-tls`**, **`generate-envoy-client-cert.sh`** |
| Pods can’t reach Postgres | **`host.docker.internal`**, **`scripts/colima-apply-host-aliases.sh`** (Runbook) |
| HTTP/3 fails on Mac host | Use Homebrew curl on PATH; **`verify-curl-http3.sh`**; in-cluster QUIC checks |

---

## 10) Relationship to the first PR

- **First PR** = what we built (listings diagnostics, k6 hooks, gateway fixes, etc.) + reviewer checklist → **`GITHUB_PR_DESCRIPTION.txt`**
- **This doc** = **how anyone reproduces the environment** and runs the same pipeline. Update **this file** when bring-up or cert steps change; keep **`GITHUB_PR_DESCRIPTION_SECOND.txt`** in sync for GitHub paste.

---

## See also

- **`docs/CERT_GENERATION_STRICT_TLS_MTLS.md`** — CA, JKS, secrets table  
- **`docs/RUN-PREFLIGHT.md`** — preflight env vars and steps  
- **`docs/CERTS_AND_TESTING_FOR_MORTALS.md`** — edge hostname, trust, smoke curls  
- **`backups/README.md`** — backup / restore  
- **`scripts/bring-up-cluster-and-infra.sh`** — single entrypoint  
- **`docs/perf/CLUSTER_CONTENTION_WATCH.md`** — optional contention logging  
