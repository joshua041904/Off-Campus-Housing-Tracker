# Certificate Generation for Strict TLS/mTLS

This doc is for teams new to the project. It explains **what certs you need** and **which scripts to run** so that strict TLS and mTLS work everywhere: Caddy (edge), gRPC backends, API gateway, and Kafka.

---

## Overview: What We Use

| Purpose | Certs | Kubernetes secret(s) | Used by |
|--------|--------|----------------------|--------|
| **CA (root)** | `dev-root.pem`, `dev-root.key` | `dev-root-ca` (CA only) | All verification; must sign every other cert |
| **Edge / leaf** | `off-campus-housing.local.crt`, `.key` | `off-campus-housing-local-tls`, `service-tls` | Caddy, api-gateway → auth (gRPC client), backends (gRPC server) |
| **Envoy client** | `envoy-client.crt`, `.key` | `envoy-client-tls` | Envoy → gRPC backends (mTLS client) |
| **Kafka broker + client** | CA + broker JKS + `client.crt`/`client.key` | `kafka-ssl-secret` | Kafka broker (SSL listener), messaging-service (Kafka mTLS client) |

**Policy:** No plaintext. All service-to-service and client-to-broker traffic uses strict TLS or mTLS; certs are required.

---

## Step-by-Step: Generate All Certs and Load Secrets

Run from **repo root**. Prerequisites: **openssl**, **kubectl** (cluster reachable). Optional: **keytool** (for Kafka JKS; used by `kafka-ssl-from-dev-root.sh`).

### 1. Generate CA + leaf (Caddy / service-tls)

**Option A — One-shot (recommended for first-time or “reset everything”):**

```bash
./scripts/dev-generate-certs.sh
```

Creates under `certs/`:

- `dev-root.pem`, `dev-root.key` — dev CA
- `off-campus-housing.local.crt`, `off-campus-housing.local.key` — edge leaf for Caddy
- Optional: `messaging-service.*`, `media-service.*`, `kafka-dev/` (Kafka client for local dev)

**Option B — Re-issue CA + leaf and load into cluster (keeps CA key for later steps):**

```bash
KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh
```

This **regenerates** CA + leaf, updates Kubernetes secrets (`dev-root-ca`, `off-campus-housing-local-tls`, `service-tls`), and restarts Caddy/services. **`KAFKA_SSL=1`** is important: it persists **`certs/dev-root.key`** so you can run the Envoy and Kafka scripts below.

### 2. Load Caddy + app TLS secrets (if you only ran dev-generate-certs.sh)

If you used **Option A** (dev-generate-certs.sh) and did **not** run reissue, load secrets into the cluster:

```bash
./scripts/strict-tls-bootstrap.sh
```

This creates/updates:

- `off-campus-housing-local-tls` (leaf) in `ingress-nginx` and `off-campus-housing-tracker`
- `dev-root-ca` in `ingress-nginx`, `off-campus-housing-tracker`, `envoy-test`
- `service-tls` in `off-campus-housing-tracker` (leaf + key + `ca.crt` for gRPC server and client)

Requires: `certs/off-campus-housing.local.crt`, `certs/off-campus-housing.local.key`, `certs/dev-root.pem`.

### 3. Envoy client cert (gRPC mTLS: Envoy → backends)

Backends expect a **client cert** from Envoy (not the edge leaf). Generate and load:

```bash
./scripts/generate-envoy-client-cert.sh
./scripts/strict-tls-bootstrap.sh
```

Requires: **`certs/dev-root.key`** (so run reissue with `KAFKA_SSL=1` first, or ensure dev-root.key exists from a previous run).

- **Output:** `certs/envoy-client.crt`, `certs/envoy-client.key`
- **Secret:** `envoy-client-tls` in `envoy-test` (created by strict-tls-bootstrap.sh when those files exist)

### 4. Kafka SSL (broker + Node client mTLS)

For Kafka **strict TLS and mTLS** (broker SSL on 9093, clients present client cert):

```bash
./scripts/kafka-ssl-from-dev-root.sh
```

Requires: **`certs/dev-root.pem`** and **`certs/dev-root.key`** (e.g. from `KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh`).

- **Output:** `certs/kafka-ssl/` (keystore, truststore, `ca-cert.pem`, **`client.crt`**, **`client.key`**)
- **Secret:** `kafka-ssl-secret` in `off-campus-housing-tracker` with:
  - `ca-cert.pem`, `ca.crt` — CA for broker and clients
  - `client.crt`, `client.key` — **Node/KafkaJS client cert** (messaging-service, etc.)
  - JKS/passwords for the Kafka broker

Deployments that use Kafka with `KAFKA_SSL_ENABLED=true` (e.g. **messaging-service**) must mount this secret and set:

- `KAFKA_CA_CERT` → `/etc/kafka/secrets/ca-cert.pem`
- `KAFKA_CLIENT_CERT` → `/etc/kafka/secrets/client.crt`
- `KAFKA_CLIENT_KEY` → `/etc/kafka/secrets/client.key`

---

## Recommended Order (first-time or clean slate)

1. **CA + leaf + load into cluster**
   - `KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh`
   - (Or: `./scripts/dev-generate-certs.sh` then `./scripts/strict-tls-bootstrap.sh`.)

2. **Envoy client cert**
   - `./scripts/generate-envoy-client-cert.sh`
   - `./scripts/strict-tls-bootstrap.sh`

3. **Kafka broker + client cert and secret**
   - `./scripts/kafka-ssl-from-dev-root.sh`

4. **Caddy (if not already rolled out)**
   - `CADDY_USE_LOADBALANCER=1 ./scripts/rollout-caddy.sh`
   - Ensure TLS secret name matches (default: `off-campus-housing-local-tls`).

5. **Deploy / rollout**
   - `kubectl apply -k infra/k8s/overlays/dev`
   - Restart gRPC/TLS workloads after any secret change so they pick up new certs.

---

## Where Each Secret Is Used

| Secret | Namespace(s) | Contents | Used by |
|--------|--------------|----------|--------|
| `dev-root-ca` | `ingress-nginx`, `off-campus-housing-tracker`, `envoy-test` | `dev-root.pem` | Caddy/backends trust; tests |
| `off-campus-housing-local-tls` | `ingress-nginx`, `off-campus-housing-tracker` | `tls.crt`, `tls.key` (leaf) | Caddy TLS |
| `service-tls` | `off-campus-housing-tracker` | `tls.crt`, `tls.key`, `ca.crt` | api-gateway (gRPC client), auth-service, messaging-service (gRPC server + probes) |
| `envoy-client-tls` | `envoy-test` | `envoy.crt`, `envoy.key` | Envoy (mTLS client to backends) |
| `kafka-ssl-secret` | `off-campus-housing-tracker` | `ca-cert.pem`, `client.crt`, `client.key`, JKS/passwords | Kafka broker; messaging-service (and any Node Kafka client) |

---

## Auth and messaging-service rollouts

- **auth-service** and **messaging-service** need their **Docker images** built and available to the cluster (e.g. `auth-service:dev`, `messaging-service:dev`). If you see **ImagePullBackOff**, build and load the image (e.g. `docker build -t auth-service:dev -f services/auth-service/Dockerfile .` then, on Colima, ensure the image is available to k3s).
- **messaging-service** also requires **kafka-ssl-secret** with `client.crt` and `client.key` when `KAFKA_SSL_ENABLED=true` (see [services/messaging-service/README.md](../services/messaging-service/README.md)).

---

## Troubleshooting

- **“CA and Caddy don’t match” / curl exit 60:** Re-issue and reload: `KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh`, then restart Caddy.
- **Envoy upstream connect error / reset before headers:** Envoy must present a client cert. Ensure `envoy-client.crt`/`envoy.key` exist, then run `./scripts/strict-tls-bootstrap.sh` so `envoy-client-tls` exists; restart Envoy.
- **Kafka: “cert paths required” / messaging-service crash:** Ensure `kafka-ssl-secret` has `ca-cert.pem`, `client.crt`, `client.key` (run `./scripts/kafka-ssl-from-dev-root.sh`) and that messaging-service deploy mounts them and sets `KAFKA_CA_CERT`, `KAFKA_CLIENT_CERT`, `KAFKA_CLIENT_KEY`.

See also: [STRICT_TLS_MTLS_AND_KAFKA.md](./STRICT_TLS_MTLS_AND_KAFKA.md), [Runbook.md](../Runbook.md) (TLS/mTLS items).
