# Local developer onboarding (KRaft Kafka, MetalLB, edge)

This doc answers **developer experience** questions after moving Kafka off Docker Compose to **three-broker KRaft in Kubernetes**, and documents the **one-command** path.

## Backend: use this order

### 1) Clean build — images once

**`make dev-onboard` does not build container images for you.** It assumes **:dev** images already exist in the Docker daemon that Colima/k3s uses.

From the repo root, build (or rebuild after Dockerfile changes) and load into the cluster:

```bash
make images
```

(`make images` → `scripts/build-housing-images-k3s.sh`. Heavier refresh: `make images-all`.)

### 2) Full local stack (~20–28 min first time)

From the repo root (Colima recommended). **MetalLB pool:** leave **`METALLB_POOL` unset** in `make cluster` / `make up` — **`scripts/install-metallb-colima.sh`** and **`setup-new-colima-cluster.sh`** pick **`.240`–`.250`** on the Colima VM / node subnet automatically. Override only if you must.

```bash
# Optional: restore all eight Postgres DBs from the newest backup snapshot
export RESTORE_BACKUP_DIR=latest

make dev-onboard
```

Omit **`RESTORE_BACKUP_DIR`** if you want empty databases instead of restoring from **`backups/`**.

**What `make dev-onboard` runs (high level):**

1. **`make up`** — Same as a teammate cloning the repo with **nothing** pre-created:
   - **`deps`** — `pnpm install`, Playwright Chromium, chmod cluster script.
   - **`cluster`** → **`scripts/setup-new-colima-cluster.sh`** — Colima + k3s + MetalLB (auto pool from VM eth0 / node IP when **`METALLB_POOL`** empty) + namespaces (**ingress-nginx**, **envoy-test**, **off-campus-housing-tracker**).
   - **`tls-first-time`** — CA + service TLS + **`strict-tls-bootstrap.sh`** + **`kafka-ssl-from-dev-root.sh`** → creates **`kafka-ssl-secret`** (required before KRaft).
   - **`infra-host`** → **`scripts/bring-up-external-infra.sh`** — Docker Compose: **8× Postgres, Redis, MinIO** (no Compose Kafka).
   - **`infra-cluster`** with **`SKIP_CLUSTER=1`** → **`scripts/bring-up-cluster-and-infra.sh`** — skips re-running setup-new-colima-cluster; runs compose ensure, **`bootstrap-after-bring-up.sh`**, **`verify-bootstrap.sh`**, **`inspect-external-db-schemas.sh`** (optional **`RESTORE_BACKUP_DIR`**).
   - Then **metallb-fix**, **`hosts-sanity` / `ensure-edge-hosts`** (default **`HOSTS_AUTO=1`**: discovers Caddy/ingress **LoadBalancer IP** via **kubectl** and appends **`/etc/hosts`** with **sudo** when missing — no IP yet before **deploy-dev** is OK), **preflight-gate**, etc.
2. **`make kafka-onboarding-reset`** — Deletes **kafka-0/1/2-external** LoadBalancers and headless **kafka** Service (and related EndpointSlices) so the next apply gets **fresh MetalLB** assignments and clean DNS (no-op on first run if resources are absent).
3. **`make apply-kafka-kraft`** — **`kubectl apply -k infra/k8s/kafka-kraft-metallb/`** and **wait for StatefulSet rollout** (requires **`kafka-ssl-secret`** from **`make up`**).
4. **`make onboarding-kafka-preflight`** — **cleanup** ops Job pods, **verify-kafka-dns**, **preflight-kafka-k8s**, **verify-kafka-bootstrap**.
5. **`make verify-kafka-cluster`** — Full ritual including **meta.properties** **cluster.id** / **node.id**, TLS SANs, **advertised.listeners**, quorum, broker API (fails before **`deploy-dev`** if Kafka is unhealthy).
6. **`SKIP_STRICT_ENVELOPE=1`** **`deploy-dev`** — kustomize **overlays/dev**, Caddy rollout, workloads.
7. **`make wait-for-caddy-ip`** — Polls until **caddy-h3** has an **EXTERNAL-IP** (~120s max) so **`ensure-edge-hosts`** does not race MetalLB.
8. **`make ensure-edge-hosts`** with **`EDGE_HOSTS_STRICT=1`** — Rewrites **`/etc/hosts`** for **off-campus-housing.test** (replaces **stale** lines if the LB IP changed; **sudo**).
9. **`make onboarding-edge`** — **verify-preflight-edge-routing** (ingress parity, DNS → LB, HTTPS — not **ping**).

**`/etc/hosts`:** Handled automatically (**`HOSTS_AUTO=1`**); stale IPs are **replaced**, not duplicated. **`HOSTS_AUTO=0`** for hints only; **`EXTERNAL_IP=`** to pin. **`OCH_EDGE_HOSTNAME`** overrides the hostname.

**Broken KRaft / split cluster.id:** **`make kafka-clean-slate`** (destroys broker PVCs; use **`KAFKA_CLEAN_SLATE_CONFIRM=YES`** to skip the interactive prompt).

**Failure meanings:** see **`docs/DEV_ONBOARDING_FAILURE_MODES.md`**.

**Teammate shortcuts:** **`make setup`** (= **`make dev-onboard`**), **`make verify`**, **`make reset`** (= **`make kafka-clean-slate`**), **`make diagnose`**.

### Twelve-step mental model

1. **Cluster boot** — Colima + k3s (local) or existing kube context.  
2. **MetalLB pool** — Auto **`.240`–`.250`** on VM/node subnet unless **`METALLB_POOL`** set.  
3. **Host TLS + trust** — **`tls-first-time`** (dev-root, service TLS, Kafka JKS seed).  
4. **Kafka service reset** — Drop external + headless Services for fresh LB / slices.  
5. **Staged Kafka apply** — Recreate Services → **wait for LB IPs** → **regenerate `kafka-ssl-secret` SANs** → StatefulSet (restart if already existed).  
6. **KRaft rollout** — Three brokers Ready.  
7. **DNS + topics** — **`verify-kafka-dns`**, topic preflight, bootstrap string.  
8. **Cluster verification** — **meta.properties**, TLS SANs, **advertised.listeners**, quorum, API.  
9. **App deploy** — **`deploy-dev`**.  
10. **Edge IP** — **`wait-for-caddy-ip`**.  
11. **`/etc/hosts`** — **`ensure-edge-hosts`** (STRICT: resolver must match Caddy LB).  
12. **Edge gates** — **`verify-preflight-edge-routing`** (HTTPS / QUIC paths, not ping).

**EKS:** **`make dev-onboard-eks`** runs verify-only (no MetalLB pool, hosts, or Kafka reset). Use ACM / cert-manager and real DNS.

**After onboarding:** `pnpm run rebuild:service:trust` (or any service) as before — needs **kubectl** context + images; it does **not** re-run full cluster setup.

---

## Minimal steps (Kafka + edge end-to-end)

If you already have cluster + TLS + host DBs and only need **Kafka + routing**:

```bash
export KUBECONFIG="$HOME/.colima/default/kubeconfig"   # if needed

make apply-kafka-kraft
make onboarding-kafka-preflight
SKIP_STRICT_ENVELOPE=1 make deploy-dev
EDGE_HOSTS_STRICT=1 make ensure-edge-hosts
make onboarding-edge
```

---

**Note:** If you only ran **`make up`** first, **`hosts-sanity`** may have skipped **`/etc/hosts`** (no **caddy-h3** LoadBalancer IP yet). After **`deploy-dev`**, run **`EDGE_HOSTS_STRICT=1 make ensure-edge-hosts`** before edge checks. **`make dev-onboard`** does this automatically.

---

## Developer experience vs old Compose Kafka

| Topic | Compose single Kafka (legacy) | Current (KRaft ×3 in cluster) |
|--------|-------------------------------|-------------------------------|
| **First-time cost** | One container, faster cold start | Three pods, quorum, PVCs — **slower first boot**, more RAM/CPU |
| **Day-to-day** | Same broker every `compose up` | Brokers stay up; you mostly **rollout** app images, not reprovision Kafka |
| **Parity** | Not like prod HA | **Replication + quorum** closer to real operations |
| **DNS / stale pods** | Less moving parts | **Headless Service** + parallel StatefulSet — use **`make onboarding-kafka-preflight`** and **`cleanup-kafka-ops-pods`** when DNS looks “stuck” |
| **Certs (EKU)** | Kafka JKS from same dev root | Unchanged intent: **`make tls-first-time`** → **`kafka-ssl-from-dev-root.sh`** aligns broker SANs / chain with **dev-root** and service mTLS |

**Additional steps vs Compose-only:** `kubectl apply` KRaft bundle, wait for rollout, topic preflight, and **MetalLB + /etc/hosts** for edge — encoded in **`make dev-onboard`**.

---

## Are all services fully reliant on in-cluster Kafka?

**For full platform behavior (events, outbox consumers, analytics pipeline): yes** — workloads expect **KAFKA_BROKER** (bootstrap to **kafka-0..2:9093** or equivalent) in **app-config** and brokers **in the cluster**.

**Fallback:** **`infra/k8s/overlays/kafka-host-compose`** exists but is **deprecated** (see overlay `kustomization.yaml`). It patches **app-config** toward **kafka-external** Endpoints so a **host-side** broker could be wired in for rare experiments — **not** the supported daily path. Default **overlays/dev** does **not** use it.

**CI / unit tests** may still use a **single TLS broker** script (`scripts/ci/start-kafka-tls-ci.sh`) — orthogonal to laptop KRaft.

---

## Makefile targets (reference)

| Target | Purpose |
|--------|---------|
| `make images` | Build **:dev** service images and load into Colima/k3s (**run before** first `dev-onboard`; onboard does not build images). |
| `make dev-onboard` | Full onboarding (see above). |
| `make apply-kafka-kraft` | Apply KRaft manifests + wait for StatefulSet. |
| `make onboarding-kafka-preflight` | Cleanup ops pods, DNS verify, topic preflight, bootstrap verify. |
| `make kafka-onboarding-reset` | Fresh Kafka LB + headless Services before **`apply-kafka-kraft`**. |
| `make kafka-clean-slate` | Delete StatefulSet + PVCs + reset Services (**DESTROYS** broker data). |
| `make wait-for-caddy-ip` | Wait for **caddy-h3** MetalLB IP. |
| `make ensure-edge-hosts` | **`/etc/hosts`** for edge hostname → LB IP (strict: **`EDGE_HOSTS_STRICT=1`**). |
| `make onboarding-edge` | Edge routing / HTTPS verify (curl — not ICMP). |
| `make up` | Cluster + TLS + host infra + bootstrap **without** KRaft apply and **without** `deploy-dev`. |
| `make cleanup-kafka-ops-pods` | Remove finished kafka-quorum / DNS remediator Job pods. |

---

## Frontend (Next.js webapp)

From the **repo root** after the backend stack is up (gateway reachable; see **`webapp/README.md`**):

```bash
pnpm install   # once per clone / lockfile change
pnpm --filter webapp dev     # daily work; hot reload at http://localhost:3000
```

When you need a **production** check (not every edit): `pnpm --filter webapp build` then `pnpm --filter webapp start`.

---

## Related docs

- `README.md` — build/run overview  
- `webapp/README.md` — webapp env, E2E, k6  
- `docs/MAKE_DEMO.md` — Colima, MetalLB pool, k3d  
- `docs/ENGINEERING_DELIVERABLE_REPORT.md` §2.4.8 — MetalLB justification  
- `docker-compose.yml` — Postgres / Redis / MinIO only (comments: Kafka in-cluster)
