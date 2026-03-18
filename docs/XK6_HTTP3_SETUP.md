# xk6-http3 setup and usage

k6 does not ship HTTP/3 (QUIC). This repo uses **xk6-http3** (custom k6 binary with quic-go) for HTTP/3 load tests and protocol comparison.

## One-time setup

1. **Extension** is in the repo at `xk6-http3/` (no clone needed).
2. **Build** the custom binary:
   ```bash
   ./scripts/build-k6-http3.sh
   ```
   Requires Go and xk6 (`go install go.k6.io/xk6/cmd/xk6@latest`). Output: `.k6-build/bin/k6-http3`.
3. **Preflight** (when `RUN_K6=1`) builds xk6-http3 in step 6d if the binary is missing. Set `SKIP_XK6_BUILD=1` to skip.

## Usage

- **From host (MetalLB):** Preflight and `run-k6-phases.sh` set `BASE_URL` to the Caddy LoadBalancer IP when available (e.g. `https://192.168.64.240:443`), so k6 does not hit `127.0.0.1:443`. No extra env needed.
- **In-cluster:** Set `K6_IN_CLUSTER=1` so `BASE_URL=https://caddy-h3.ingress-nginx.svc.cluster.local:443`.
- **Override:** Pass `BASE_URL=...` and/or `HOST=off-campus-housing.local` when invoking k6 or `run-k6-phases.sh`.

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
| `scripts/build-k6-http3.sh` | Build `.k6-build/bin/k6-http3` (uses local `xk6-http3/`) |
| `scripts/load/run-k6-phases.sh` | Runs read/soak/limit/max + optional HTTP/3 phase; sets BASE_URL from MetalLB or in-cluster |
| `scripts/load/run-k6-protocol-comparison.sh` | HTTP/2 vs HTTP/3 comparison → `protocol-comparison.json` |
| `scripts/load/k6-http3-complete.js` | Full k6 HTTP/3 toolchain (requires xk6-http3 binary) |

## Troubleshooting

- **SyntaxError in k6-http3-complete.js:** k6’s runtime does not support object spread (`...`). Use `Object.assign` (already fixed in repo).
- **dial tcp 127.0.0.1:443: can't assign requested address:** From host, `off-campus-housing.local` resolved to 127.0.0.1. Ensure MetalLB is up and Caddy has an LB IP so `run-k6-phases.sh` can set `BASE_URL` to it, or set `BASE_URL=https://<LB_IP>:443` manually.
- **xk6-http3 not found:** Run `./scripts/build-k6-http3.sh` once. Preflight step 6d does this when `RUN_K6=1` unless `SKIP_XK6_BUILD=1`.
