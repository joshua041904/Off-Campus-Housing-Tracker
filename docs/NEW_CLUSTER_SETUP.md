# New Colima + k3s cluster (after `colima delete`)

Use this when you have no Colima instance (e.g. after `colima delete` and `rm -rf ~/.colima`) and want a fresh cluster with **16 GB RAM, 12 CPUs, 256 GB disk**, **bridged networking** (for MetalLB L2), and **k3s**.

## One-shot script (recommended)

From repo root:

```bash
./scripts/setup-new-colima-cluster.sh
```

This will:

1. Start Colima with **12 CPU, 16 GiB RAM, 256 GiB disk**, **--network-address** (bridged), k3s v1.29.6+k3s1.
2. Wait for the API and fix kubeconfig (localhost).
3. Install MetalLB (L2 pool) and bring up the platform (namespaces, TLS, kustomize, Caddy LoadBalancer).

MetalLB pool: **leave `METALLB_POOL` unset** so `install-metallb-colima.sh` picks `.240-.250` on the **current** VM /24 (bridged eth0 or node InternalIP). Override only after checking `colima ssh -- ip -4 addr show eth0`:

```bash
METALLB_POOL=192.168.64.240-192.168.64.250 ./scripts/setup-new-colima-cluster.sh
```

---

## Manual steps (same flow)

### 1. Start Colima (bridged, 12 CPU / 16 GiB / 256 GiB)

```bash
./scripts/colima-start-k3s-bridged-clean.sh
```

Defaults: **12 CPU, 16 GiB RAM, 256 GiB disk**, k3s v1.29.6+k3s1, **--network-address** (bridged). Override: `CPU=8 MEMORY=12 DISK=100 ./scripts/colima-start-k3s-bridged-clean.sh`.

Wait until it prints “Control plane stable (3/3). Next: …”.

### 2. Install MetalLB and bring up the cluster

```bash
./scripts/colima-metallb-bring-up.sh
```

Optional pool (only if auto-detect is wrong — must match VM eth0 /24):

```bash
METALLB_POOL=192.168.64.240-192.168.64.250 ./scripts/colima-metallb-bring-up.sh
```

To only install MetalLB (no bring-up): `./scripts/install-metallb-colima.sh` then later `./scripts/bring-up-colima-cluster.sh`.

### 3. Dependencies (for app pods)

Start Postgres, Redis, Kafka, etc. on the host so pods can reach them at `host.docker.internal`:

```bash
./scripts/ensure-dependencies-ready.sh
```

Then restart or scale deployments as needed. See **docs/COLIMA-K3S-METALLB-PRIMARY.md** and **docs/DISK_PRESSURE_AND_LOADBALANCER_RECOVERY.md**.

---

## Verify

- **Nodes:** `kubectl get nodes`
- **Caddy LB IP:** `kubectl -n ingress-nginx get svc caddy-h3`
- **HTTP/3:** `curl -k --http3-only https://<LB_IP>/_caddy/healthz`
- **Transport validation:** `python3 scripts/run_transport_validation.py --capture --v2 --require-transport-proof` (after Caddy pods are Running)
