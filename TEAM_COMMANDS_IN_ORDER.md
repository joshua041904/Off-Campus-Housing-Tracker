# Team commands (in order)

Run everything from the **repo root**. Copy **one shell block at a time**; if a step fails, stop and fix it before the next block.

- Deeper FAQ / test map: `GITHUB_PR_DESCRIPTION.txt`
- TLS + JKS table: `docs/PR_SECOND_ONBOARDING.md`
- CA / hosts: `docs/LOCAL_TLS_AND_TESTING_GUIDE.md`, `docs/CERT_GENERATION_STRICT_TLS_MTLS.md`

---

## 1) Fast paths (what most people need)

### A. Stack already up — run preflight only

```bash
cd /path/to/Off-Campus-Housing-Tracker
mkdir -p bench_logs

# Recommended default: strict canonical v2 + protocol matrix + flatten to 10 files
env \
  METALLB_ENABLED=1 REQUIRE_COLIMA=0 RUN_PGBENCH=0 ROTATION_H2_KEYLOG=0 PREFLIGHT_K6_MESSAGING_LIMIT_FINDER=1 \
  PREFLIGHT_PERF_ARTIFACTS=1 PREFLIGHT_PERF_PROTOCOL_MATRIX=1 PREFLIGHT_PERF_STRICT_CANONICAL=1 \
  PREFLIGHT_PERF_FLATTEN_TO_10=1 PREFLIGHT_PERF_ENSURE_XK6_HTTP3=1 \
  ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 \
  | tee "bench_logs/preflight-canonical-v2-$(date +%Y%m%d-%H%M%S).log"
```

Lighter preflight (no strict perf bundle requirements):

```bash
cd /path/to/Off-Campus-Housing-Tracker
mkdir -p bench_logs
env \
  METALLB_ENABLED=1 REQUIRE_COLIMA=0 RUN_PGBENCH=0 ROTATION_H2_KEYLOG=0 PREFLIGHT_K6_MESSAGING_LIMIT_FINDER=1 \
  ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 \
  | tee "bench_logs/preflight-no-pgbench-$(date +%Y%m%d-%H%M%S).log"
```

### B. Optional: reuse — paste once as functions (same flags, shorter to type)

```bash
och_preflight_light() {
  mkdir -p bench_logs
  env \
    METALLB_ENABLED=1 REQUIRE_COLIMA=0 RUN_PGBENCH=0 ROTATION_H2_KEYLOG=0 PREFLIGHT_K6_MESSAGING_LIMIT_FINDER=1 \
    ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 \
    | tee "bench_logs/preflight-no-pgbench-$(date +%Y%m%d-%H%M%S).log"
}

och_preflight_strict_canonical_v2() {
  mkdir -p bench_logs
  env \
    METALLB_ENABLED=1 REQUIRE_COLIMA=0 RUN_PGBENCH=0 ROTATION_H2_KEYLOG=0 PREFLIGHT_K6_MESSAGING_LIMIT_FINDER=1 \
    PREFLIGHT_PERF_ARTIFACTS=1 PREFLIGHT_PERF_PROTOCOL_MATRIX=1 PREFLIGHT_PERF_STRICT_CANONICAL=1 \
    PREFLIGHT_PERF_FLATTEN_TO_10=1 PREFLIGHT_PERF_ENSURE_XK6_HTTP3=1 \
    ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 \
    | tee "bench_logs/preflight-canonical-v2-$(date +%Y%m%d-%H%M%S).log"
}
```

From repo root: `och_preflight_strict_canonical_v2` or `och_preflight_light`.

---

## 2) First-time setup — chained blocks (Colima + TLS + infra)

Replace `/path/to/Off-Campus-Housing-Tracker` and fix **MetalLB pool** if `caddy-h3` stays `<pending>` (see §4).

### Block 1 — Dependencies

```bash
cd /path/to/Off-Campus-Housing-Tracker
pnpm install && pnpm --filter webapp exec playwright install chromium
chmod +x scripts/setup-new-colima-cluster.sh
```

### Block 2 — Colima / k3s / MetalLB

```bash
export KUBECONFIG="${KUBECONFIG:-$HOME/.colima/default/kubeconfig}"
METALLB_POOL=192.168.64.240-192.168.64.250 ./scripts/setup-new-colima-cluster.sh
colima ssh -- ip -4 addr show eth0
```

### Block 3 — TLS: CA, leaf, Envoy, Kafka JKS (single chain)

```bash
KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh \
  && ./scripts/generate-envoy-client-cert.sh \
  && ./scripts/strict-tls-bootstrap.sh \
  && ./scripts/kafka-ssl-from-dev-root.sh
```

### Block 4 — macOS trust + HTTP/3 curl

```bash
./scripts/lib/trust-dev-root-ca-macos.sh certs/dev-root.pem
export PATH="/opt/homebrew/opt/curl/bin:$PATH"
./scripts/verify-curl-http3.sh
```

On Intel Homebrew, use: `export PATH="/usr/local/opt/curl/bin:$PATH"`

### Block 5 — Host Docker infra + cluster deploy

```bash
export PGPASSWORD=postgres
RESTORE_BACKUP_DIR=latest ./scripts/bring-up-external-infra.sh
```

Optional (analytics LLM on Mac — skip if you use `SKIP_K6_ANALYTICS_LISTING_FEEL=1` on preflight):

```bash
kubectl set env deployment/analytics-service -n off-campus-housing-tracker \
  OLLAMA_BASE_URL=http://host.docker.internal:11434
```

```bash
export PGPASSWORD=postgres
RESTORE_BACKUP_DIR=latest ./scripts/bring-up-cluster-and-infra.sh
```

### Block 6 — Edge IP, `/etc/hosts`, gates

```bash
kubectl -n ingress-nginx get svc caddy-h3 -o wide
./scripts/apply-metallb-pool-colima.sh
kubectl get svc -n ingress-nginx
```

Add hosts (replace `<EXTERNAL_IP>` with the LoadBalancer IP):

```bash
sudo sh -c 'echo "<EXTERNAL_IP> off-campus-housing.test" >> /etc/hosts'
```

```bash
./scripts/ensure-ready-for-preflight.sh
./scripts/verify-http3-edge.sh
```

Optional Wireshark key log:

```bash
mkdir -p bench_logs
export SSLKEYLOGFILE="$PWD/bench_logs/sslkeylog-$(date +%Y%m%d-%H%M%S).log"
curl --cacert certs/dev-root.pem -sS -I --http3 https://off-campus-housing.test/
```

Then run **§1** preflight.

---

## 3) Frontend after the stack is up

- In browser: `https://off-campus-housing.test` (needs `/etc/hosts` + stack).

Optional rebuild with local env:

```bash
cp webapp/env.local.template webapp/.env.local && ./scripts/rebuild-housing-colima.sh
```

Local Next + port-forward:

```bash
# Terminal A
kubectl port-forward -n off-campus-housing-tracker deployment/api-gateway 4020:4020

# Terminal B
cd /path/to/Off-Campus-Housing-Tracker && pnpm install && pnpm --filter webapp dev
```

---

## 4) Notes (short)

| Topic | What to know |
|--------|----------------|
| `KUBECONFIG` | Only if `kubectl` does not see Colima; skip on k3d/Linux if default is fine. |
| `trust-dev-root-ca-macos.sh` | macOS only; Linux/WSL: import `certs/dev-root.pem` per TLS guide. |
| MetalLB pool | Default range matches many Colima bridges. If `eth0` is e.g. `192.168.5.x`, use `METALLB_POOL=192.168.5.240-192.168.5.250` or rely on auto-detect in `scripts/install-metallb-colima.sh` when omitting the var on setup. |
| Ollama | Second terminal: `ollama serve` then `ollama pull llama3.2`. Or skip `kubectl set env` and add `SKIP_K6_ANALYTICS_LISTING_FEEL=1` for a faster preflight. |
| k3d / no Colima | Skip `setup-new-colima-cluster.sh`; keep `REQUIRE_COLIMA=0` on preflight (already in examples). |

---

## 5) One-off commands

```bash
curl --cacert certs/dev-root.pem -sS -o /dev/null -w "%{http_code}\n" https://off-campus-housing.test/api/readyz
```

```bash
SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/run-housing-k6-edge-smoke.sh
```

```bash
chmod +x scripts/perf/build-canonical-bundle.sh scripts/load/run-k6-protocol-matrix.sh scripts/perf/summarize-protocol-matrix.sh
./scripts/perf/build-canonical-bundle.sh
SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/load/run-k6-protocol-matrix.sh
```

---

## 6) Plain-text mirror

The same content (ASCII separators, no Markdown) lives in `TEAM_COMMANDS_IN_ORDER.txt` for editors that prefer `.txt`.
