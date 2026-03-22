# Certs & testing — step-by-step (Off-Campus Housing Tracker)

This is the **checklist order** that matches what the cluster and scripts expect. Do not skip steps unless you know why.

---

## 0. What you need installed

- **Docker** + **Docker Compose** (for Postgres 5441–5448, Redis 6380, Kafka, MinIO).
- **Colima + k3s** or **k3d** (scripts assume context names like Colima’s k3s or `k3d-off-campus-housing-tracker`).
- **kubectl**, **openssl**, **pnpm** (for messaging-service tests), optional **k6** (load smokes).
- **curl** with HTTP/3 for edge checks (Homebrew `curl` on macOS).

---

## 1. Generate local TLS / Kafka file artifacts

From **repo root**:

```bash
./scripts/dev-generate-certs.sh
```

Creates under `certs/` (among others):

| Artifact | Purpose |
|----------|---------|
| `dev-root.pem`, `dev-root.key` | Dev CA |
| `off-campus-housing.test.crt`, `.key` | Caddy / ingress leaf (SNI **off-campus-housing.test**) |
| Per-service certs (if generated) | Optional; many flows use **service-tls** secret with the **same leaf** as edge |
| `certs/kafka-dev/*`, `certs/kafka-ssl/*` | Kafka TLS clients / broker material for Docker |

**Envoy mTLS client** (backend expects CN=envoy, signed by **same** dev CA):

```bash
./scripts/generate-envoy-client-cert.sh
# expects certs/dev-root.key to exist
```

---

## 2. Load secrets into Kubernetes (strict TLS / mTLS)

Still from repo root:

```bash
./scripts/strict-tls-bootstrap.sh
```

This creates/updates:

- **ingress-nginx** + **off-campus-housing-tracker**: `off-campus-housing-local-tls`, `dev-root-ca`
- **off-campus-housing-tracker**: `service-tls` (`tls.crt`, `tls.key`, `ca.crt`) for gRPC/TLS servers and clients
- **envoy-test**: `dev-root-ca`, `envoy-client-tls` (if `certs/envoy-client.{crt,key}` exist)

**Shortcut** (generates certs + builds tcpdump images + applies): `./scripts/setup-tls-and-edge.sh`

**OCH naming:** Some manifests reference **`och-service-tls`** as an alias of the same material as `service-tls`. If pods fail with `FailedMount` / missing secret, create it from the same files:

```bash
kubectl -n off-campus-housing-tracker create secret generic och-service-tls \
  --from-file=tls.key=certs/off-campus-housing.test.key \
  --from-file=tls.crt=certs/off-campus-housing.test.crt \
  --from-file=ca.crt=certs/dev-root.pem \
  --dry-run=client -o yaml | kubectl apply -f -
```

Similarly **`och-kafka-ssl-secret`** may be needed as a copy of **`kafka-ssl-secret`** when manifests expect the `och-*` name.

---

## 3. Kafka TLS secret for namespaces

If workloads mount `/etc/kafka/secrets`:

```bash
./scripts/kafka-ssl-from-dev-root.sh
# or your project’s script that populates kafka-ssl-secret
```

Kafka brokers should be **external** (Docker Compose), not an in-cluster `kafka` Deployment.

---

## 4. Host DNS for edge tests

Add to **`/etc/hosts`** (or pass `curl --resolve` only):

```text
127.0.0.1 off-campus-housing.test
```

With **MetalLB**, scripts use:

```bash
curl --resolve off-campus-housing.test:443:<LB_IP> https://off-campus-housing.test/_caddy/healthz
```

Get `<LB_IP>`: `kubectl -n ingress-nginx get svc caddy-h3`.

---

## 5. MetalLB pool vs node subnet (avoid HTTP 000)

- **Symptom:** curl to LB IP hangs or `HTTP 000`; in-cluster works.
- **Cause:** Pool on wrong subnet (e.g. `192.168.5.x` while Colima node is `192.168.64.x`).
- **Fix:** `./scripts/apply-metallb-pool-colima.sh` (detects node subnet) or set `METALLB_POOL` to a range on the **node’s** subnet; delete/recreate `caddy-h3` Service if IP sticks wrong.

---

## 6. External infra (Postgres, Redis, Kafka)

```bash
./scripts/bring-up-external-infra.sh
# optional: RESTORE_BACKUP_DIR=latest
```

Messaging DB is **5444**; media **5448**. Redis for local tests: **127.0.0.1:6380**.

---

## 7. Colima / k3d: reach host from pods

- **Colima:** `./scripts/colima-apply-host-aliases.sh` (or preflight does similar) so `host.docker.internal` resolves to the Mac gateway.
- **k3d:** `./scripts/apply-k3d-host-aliases.sh`.

---

## 8. Build and load images (auth, messaging, media, gateway)

From repo root:

```bash
docker build -f services/api-gateway/Dockerfile -t api-gateway:dev .
docker build -f services/auth-service/Dockerfile -t auth-service:dev .
docker build -f services/messaging-service/Dockerfile -t messaging-service:dev .
docker build -f services/media-service/Dockerfile -t media-service:dev .

docker save api-gateway:dev | colima ssh -- docker load
docker save auth-service:dev | colima ssh -- docker load
docker save messaging-service:dev | colima ssh -- docker load
docker save media-service:dev | colima ssh -- docker load
```

Then:

```bash
kubectl apply -k infra/k8s/base
```

---

## 9. Tests — what to run and in what order

### A. Messaging + media (Vitest)

**Messaging** (needs Redis on 6380):

```bash
redis-cli -h 127.0.0.1 -p 6380 ping   # expect PONG
pnpm -C services/messaging-service test
```

Vitest uses `vitest.config.ts` + `tests/setup/env.ts` to set `REDIS_*` / `REDIS_URL` for **127.0.0.1:6380**.

**Media** (needs Postgres **media** on **5448**):

```bash
pnpm -C services/media-service test
```

Uses `tests/setup/env.ts` for `PG_HOST` / `PG_PORT` defaults (**127.0.0.1:5448**).

### B. Housing HTTP/2 + HTTP/3 + gRPC + latency artifacts

```bash
./scripts/test-microservices-http2-http3-housing.sh
```

Writes CSV/SVG under `bench_logs/` when latency section runs (see script).

### C. Messaging / forum via edge (comprehensive shell suite)

```bash
./scripts/test-messaging-service-comprehensive.sh
```

Uses `TARGET_IP` / LB detection for `--resolve`.

### D. MetalLB / traffic policy sanity

```bash
./scripts/verify-metallb-and-traffic-policy.sh
```

### E. Full preflight + scoped waits

**All app deployments (default):**

```bash
./scripts/run-preflight-scale-and-all-suites.sh
```

**Only auth + gateway + messaging + media** (no long wait on listings/booking/trust/analytics):

```bash
PREFLIGHT_APP_SCOPE=core ./scripts/run-preflight-scale-and-all-suites.sh
```

Preflight runs Vitest + housing + comprehensive scripts, then **k6** on messaging + media **health** if `k6` is on PATH and `certs/dev-root.pem` + LB IP exist. Disable k6: `RUN_MESSAGING_LOAD=0`.

### F. Manual k6 (strict TLS)

```bash
export SSL_CERT_FILE="$PWD/certs/dev-root.pem"
export BASE_URL=https://off-campus-housing.test
export K6_RESOLVE=off-campus-housing.test:443:<LB_IP>
k6 run scripts/load/k6-messaging.js
k6 run scripts/load/k6-media-health.js
```

Upload/load for media (`k6-media-upload.js`) needs a **`TOKEN`** (register/login first).

---

## 10. Quick “it’s broken” map

| Symptom | Likely layer |
|---------|----------------|
| **HTTP 000**, TLS errors, `could not resolve host` | Edge / DNS / MetalLB subnet / wrong `--resolve` |
| **HTTP 503** on `/auth/*` after edge is OK | **api-gateway → auth** upstream (port **4011** HTTP, TLS trust **`och-service-tls`**) |
| **404** on `/api/messages` or forum | Gateway **path rewrite** to messaging `/messages` and `/forum` |
| **Vitest `RATE_LIMIT_UNAVAILABLE` / `ENOTFOUND redis`** | Local Redis host — use **127.0.0.1:6380** in test env |
| **gRPC probe NOT_SERVING** | Wrong **gRPC service name** in probe vs registered proto |
| **ImagePullBackOff** | Build & `docker load` image into node (**media-service:dev**, etc.) |

See **Runbook.md** for numbered RCAs and Colima/k3s specifics.
