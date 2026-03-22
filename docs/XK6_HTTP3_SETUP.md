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

## Troubleshooting

- **SyntaxError in k6-http3-complete.js:** k6’s runtime does not support object spread (`...`). Use `Object.assign` (already fixed in repo).
- **dial tcp 127.0.0.1:443: can't assign requested address:** From host, `off-campus-housing.test` resolved to 127.0.0.1. Add **`MetalLB_IP off-campus-housing.test`** to `/etc/hosts`, or let `run-k6-phases.sh` set **`K6_RESOLVE=off-campus-housing.test:443:<MetalLB_IP>`** when MetalLB is present. Do **not** put the LB IP in `BASE_URL` (SAN mismatch) — keep `BASE_URL=https://off-campus-housing.test` and pin IP via `K6_RESOLVE` / hosts.
- **xk6-http3 not found:** Run `./scripts/build-k6-http3.sh` once. Preflight step 6d does this when `RUN_K6=1` unless `SKIP_XK6_BUILD=1`.
