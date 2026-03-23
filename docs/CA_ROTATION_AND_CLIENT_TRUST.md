# CA rotation, client trust, probes, and Kafka (housing)

This is the **final-mile** operational guide: internal mTLS is assumed working; remaining issues are usually **probe timing**, **Kafka topology**, and **client trust** after CA rotation.

## 1. gRPC + mTLS probe baseline (Kubernetes)

Housing app Deployments use a shared pattern (see `infra/k8s/base/docs/grpc-probes-mtls-template.yaml`):

| Probe | Role |
|-------|------|
| **startupProbe** | Long window (`periodSeconds: 5`, `failureThreshold: 30` ≈ 150s) so Kafka/DB/migrations do not race the kubelet. |
| **readinessProbe** | Traffic gate: `periodSeconds: 10`, `timeoutSeconds: 10`, `failureThreshold: 6`. |
| **livenessProbe** | Safety net only: `initialDelaySeconds: 90`, `periodSeconds: 15`, `timeoutSeconds: 10`, `failureThreshold: 5`. |

`grpc-health-probe` uses **`-connect-timeout=5s`** and **`-rpc-timeout=5s`** so each exec finishes within the probe **`timeoutSeconds: 10`**.

## 2. Kafka external (Colima / host Docker)

- **Service**: `kafka-external:9093` → **Endpoints** target host port **29094** (strict TLS).
- **Default Endpoints IP** in `infra/k8s/base/kafka-external/external-service.yaml` is **`192.168.64.1`** (typical Colima VM default gateway toward the Mac host). **Override** per machine if needed.
- **Verify from a pod**:  
  `kubectl exec -it deploy/notification-service -n off-campus-housing-tracker -- sh -c 'nc -vz kafka-external 9093'`
- **Script** (resolve host / Docker host-gateway): `./scripts/patch-kafka-external-host.sh`  
  Set **`KAFKA_EXTERNAL_HOST_IP`** explicitly if auto-detection fails.

**In-cluster Kafka** (optional) is the most stable long-term; external broker + Endpoints is acceptable if the IP is correct.

## 3. Application: Kafka must not be fatal

- Producers (listings, booking, messaging) already treat Kafka connect as **non-fatal**.
- **notification-service** starts the Kafka **consumer** on **`setImmediate`** after HTTP+gRPC so broker retries do not block the main listener during boot.
- **kafkajs** client settings are in `services/common/src/kafka.ts` (bounded `connectionTimeout`, fewer metadata retries). Override with **`KAFKAJS_CONNECTION_TIMEOUT_MS`** / **`KAFKAJS_METADATA_RETRIES`** if needed.

## 4. Ordered rollout (avoid simultaneous restarts)

Prefer:

```bash
./scripts/k8s-rollout-och-ordered.sh
```

(auth → other services → **api-gateway** last). Do **not** scale ReplicaSets by hand; use Deployments. Legacy **`aggressive-cleanup-replicasets.sh`** is a no-op unless **`OCH_AGGRESSIVE_RS_CLEANUP=1`**.

## 5. CA rotation → client trust (curl, browsers, **k6**)

After **`dev-root-ca`** / **`service-tls`** change, **cluster** trust updates via mounted secrets; **host tools** must trust the **new** root.

### k6 (Go TLS)

**Important:** standard **`k6/http` does not implement `params.tls.cacerts`** (the HTTP parser only handles cookies, headers, jar, compression, redirects, tags, auth, timeout, throw, responseCallback, etc.). Custom server roots are **not** taken from the JS `tls` object.

| OS | What works for `https://off-campus-housing.test` |
|----|--------------------------------------------------|
| **Linux** (incl. k6 in Docker) | `SSL_CERT_FILE=$PWD/certs/dev-root.pem` (or rely on system store + public chain) |
| **macOS** | Go uses **Security.framework**, not `SSL_CERT_FILE`. Add dev-root to **login keychain**: `./scripts/lib/trust-dev-root-ca-macos.sh certs/dev-root.pem` |

**Recommended invocations**

```bash
# macOS (keychain) or Linux (SSL_CERT_FILE inside wrapper):
./scripts/k6-exec-strict-edge.sh run scripts/load/k6-gateway-health.js

# macOS + Docker (Linux k6, SSL_CERT_FILE honored):
K6_USE_DOCKER_K6=1 ./scripts/k6-exec-strict-edge.sh run scripts/load/k6-gateway-health.js

# Housing per-service edge smoke (strict: https BASE_URL + SSL_CERT_FILE; no Docker/keychain automation in this script):
SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/run-housing-k6-edge-smoke.sh
```

**Dev only (other scripts):** Some grids may still use `K6_INSECURE_SKIP_TLS=1` or `K6_RESOLVE`; **`run-housing-k6-edge-smoke.sh` does not** — it requires hostname `https://…` and a real CA file.

**gRPC (`k6/grpc`)** does support `tls: { cacerts }`; **`k6/http`** does not — see `scripts/load/k6-strict-edge-tls.js`.

### Dual-CA phase (production-style, zero downtime)

1. Issue **ca-v2**; build **`ca-bundle.pem` = ca-v1 + ca-v2**; mount as trust for services and clients.
2. Reissue **leaf** certs with ca-v2; roll **auth** → **internals** → **gateway** (ordered).
3. Update **external** clients (k6, curl `--cacert`, browsers) to trust ca-v2 (or the bundle).
4. Remove ca-v1 from bundle and redeploy when stable.

## 6. Related scripts

| Script | Purpose |
|--------|---------|
| `scripts/patch-kafka-external-host.sh` | Set Endpoints IP for host Kafka |
| `scripts/k8s-rollout-och-ordered.sh` | Dependency-aware rollout |
| `scripts/reissue-ca-and-leaf-load-all-services.sh` | CA + leaf + secrets (existing) |
