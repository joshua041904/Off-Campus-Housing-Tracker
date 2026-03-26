# xk6-http3 setup and usage

k6 does not ship HTTP/3 (QUIC). This repo uses **xk6-http3** (custom k6 binary with quic-go) for HTTP/3 load tests and protocol comparison.

## One-time setup

1. **Extension + k6 core are pinned** in `scripts/build-k6-http3.sh`: default **`github.com/bandorko/xk6-http3@v0.2.0`** (latest tag on upstream; **v0.3.0 does not exist** on that repo — set `HTTP3_EXTENSION` if you use a fork). k6 core: tries **v0.49.0**, then **v0.48.0**, unless `K6_XK6_VERSION` is set.
2. **Build** the custom binary:
   ```bash
   ./scripts/build-k6-http3.sh
   ```
   Requires Go; installs **xk6 CLI** at `XK6_TOOL_VERSION` (default **v1.3.6**) if missing. Output: `.k6-build/bin/k6-http3`.
3. **If dependency resolution fails:** `XK6_PURGE_GO_CACHE=1 ./scripts/build-k6-http3.sh` (clears Go module + build caches; slow next run).
4. **Preflight** (when `RUN_K6=1`) builds xk6-http3 in step 6d if the binary is missing. Set `SKIP_XK6_BUILD=1` to skip.

## Usage

- **From host (MetalLB):** `BASE_URL` stays **`https://off-campus-housing.test`** (or `:443` explicit); **`K6_RESOLVE=off-campus-housing.test:443:<MetalLB_IP>`** pins DNS to the LB so k6 does not hit `127.0.0.1:443`. Do not use a raw IP in `BASE_URL` (SAN mismatch).
- **In-cluster:** Set `K6_IN_CLUSTER=1` so `BASE_URL=https://caddy-h3.ingress-nginx.svc.cluster.local:443`.
- **Override:** Pass `BASE_URL=...` and/or `HOST=off-campus-housing.test` when invoking k6 or `run-k6-phases.sh`.

```bash
# Host (MetalLB LB IP auto-used when available)
SUITE_LOG_DIR=/tmp/k6 K6_CA_ABSOLUTE=$PWD/certs/dev-root.pem ./scripts/load/run-k6-phases.sh

# In-cluster
K6_IN_CLUSTER=1 SUITE_LOG_DIR=/tmp/k6 ./scripts/load/run-k6-phases.sh

# Direct run with custom binary
.k6-build/bin/k6-http3 run scripts/load/k6-http3-complete.js
```

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/build-k6-http3.sh` | Build `.k6-build/bin/k6-http3` (`xk6` + `bandorko/xk6-http3`) |
| `scripts/load/run-k6-phases.sh` | Runs read/soak/limit/max + optional HTTP/3 phase; sets BASE_URL from MetalLB or in-cluster |
| `scripts/load/run-k6-protocol-comparison.sh` | HTTP/2 vs HTTP/3 comparison → `protocol-comparison.json` |
| `scripts/load/k6-http3-complete.js` | Full k6 HTTP/3 toolchain (requires xk6-http3 binary) |
| `scripts/load/run-k6-protocol-matrix.sh` | http1 / http2 / http3 matrix; per-cell logs under `protocol-matrix/k6-matrix-logs/` (see `exact_reproduce` + resolved paths in each log). **Single cell:** `./scripts/load/run-k6-protocol-matrix.sh http3 gateway` |
| `scripts/load/k6-gateway-health-http3.js` | Gateway `/api/healthz` over `k6/x/http3`; logs `res.proto` / `res.protocol` on VU 1 iter 0 |

## Troubleshooting

- **SyntaxError in k6-http3-complete.js:** k6’s runtime does not support object spread (`...`). Use `Object.assign` (already fixed in repo).
- **dial tcp 127.0.0.1:443: can't assign requested address:** From host, `off-campus-housing.test` resolved to 127.0.0.1. Add **`MetalLB_IP off-campus-housing.test`** to `/etc/hosts`, or let `run-k6-phases.sh` set **`K6_RESOLVE=off-campus-housing.test:443:<MetalLB_IP>`** when MetalLB is present. Do **not** put the LB IP in `BASE_URL` (SAN mismatch) — keep `BASE_URL=https://off-campus-housing.test` and pin IP via `K6_RESOLVE` / hosts.
- **xk6-http3 not found:** Run `./scripts/build-k6-http3.sh` once. Preflight step 6d does this when `RUN_K6=1` unless `SKIP_XK6_BUILD=1`.
- **Protocol matrix shows `"error":"k6 exited N"`:** Open `bench_logs/run-*/protocol-matrix/k6-matrix-logs/http3-<service>.log` (or your `K6_MATRIX_OUT`). The file records `k6 version`, env plan, full **stdout/stderr**, and **exit_code**. Distinguishes wrapper issues from QUIC/handshake failures. Gateway HTTP/3 script prints `[gateway-health-http3] res.proto=...` when the xk6 extension is used (field may be empty on some builds; check still passes if unset).
- **Confirm HTTP/3 in k6:** Run `.k6-build/bin/k6-http3 run scripts/load/k6-gateway-health-http3.js` with `SSL_CERT_FILE` / `K6_HTTP3_REQUIRE_MODULE=1` and inspect console for `res.proto`. Compare with `curl --http3 -I --cacert certs/dev-root.pem https://off-campus-housing.test/`.
- **Matrix vs manual `k6 run k6-gateway-health.js`:** The protocol matrix uses **stock `k6`** + `k6-gateway-health.js` for http1/http2, and **`.k6-build/bin/k6-http3`** + **`k6-gateway-health-http3.js`** for the **http3 + gateway** cell. A manual `k6 run …/k6-gateway-health.js` with `PROTOCOL=http3` is **not** the same QUIC path as the matrix (that script uses `k6/http`, not `k6/x/http3`). Compare using the **`exact_reproduce`** line from `k6-matrix-logs/http3-gateway.log`.
- **xk6-http3 panic after a successful run:** `bandorko/xk6-http3` can **SIGSEGV during module teardown** even when checks and metrics are valid. By default **`K6_MATRIX_STRICT=0`**: `run-k6-protocol-matrix.sh` detects `panic` + `github.com/bandorko/xk6-http3` in the cell log, keeps the k6 **summary JSON**, and adds **`k6_matrix_warning`** / **`k6_matrix_status: success_with_teardown_warning`** (does not replace metrics with an error blob). Set **`K6_MATRIX_STRICT=1`** in CI if any non-zero k6 exit must fail the step. Optional rebuild: **`HTTP3_EXTENSION=github.com/bandorko/xk6-http3@latest`** with `./scripts/build-k6-http3.sh`.
- **Aggregate CSV across matrix outputs:** `node scripts/perf/extract-protocol-matrix.js` writes **`bench_logs/protocol-comparison.csv`** from the **latest** `bench_logs/run-*/protocol-matrix/` (or set **`PROTOCOL_MATRIX_DIR`**). Uses **`http3_req_duration`** when **`http_req_duration`** is absent.
- **HTTP/2 connection reuse experiment (messaging):** `K6_HTTP2_DISABLE_REUSE=1 ./scripts/load/run-k6-protocol-matrix.sh http2 messaging` — `k6-messaging.js` sets k6 **`noVUConnectionReuse`**. Compare tail latency with reuse enabled (default `0`).
