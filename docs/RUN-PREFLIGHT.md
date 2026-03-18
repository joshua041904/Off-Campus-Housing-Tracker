# Running the full preflight (k6 phases + pgbench + suites)

**Colima k3s only.** The script automatically sets up **127.0.0.1:6443** (tunnel + kubeconfig); you don't need to run `colima-forward-6443.sh` manually.

## Prerequisites: Colima + externalized infra (Docker, 8 Postgres, Redis, Kafka)

If you see **"Cannot connect to the Docker daemon"** or **pods stuck 0/1 Ready** (services can't reach DB/Redis/Kafka), start Colima and the externalized stack first:

```bash
./scripts/start-colima-and-external-deps.sh
```

This will:

1. **Start Colima** (so the Docker daemon is available at `~/.colima/default/docker.sock`).
2. **Start externalized infra** via Docker Compose: **Zookeeper**, **Kafka** (port 29093), **Redis** (6379), and **8 Postgres** instances (ports 5433–5440: records, social, listings, shopping, auth, auction-monitor, analytics, python-ai).
3. **Verify** all required ports are listening.

After it succeeds, run preflight. To only check ports (no start): `./scripts/start-colima-and-external-deps.sh --verify-only`. If Colima is already running: `./scripts/start-colima-and-external-deps.sh --no-colima`.

## Run order: preflight first, then add data

1. **Run preflight first** (pgbench tuning, suites, migrations). Preflight applies DB migrations in step 3b4 and runs pgbench in step 8; it expects external Postgres (5433–5440) with schema applied but **does not** load seed/CSV data.
2. **After preflight completes**, add data:
   - Records (5433): `./scripts/load-records-csv-5433.sh` or `./scripts/load-records-csv-5433.sh records_chunks/`
   - Other DBs (5434–5437): `./scripts/seed-all-dbs.sh`

Optional: apply schemas/tuning before preflight so step 3b4 is quick: `./scripts/ensure-all-schemas-and-tuning.sh`. Use `SKIP_PREFLIGHT_MIGRATIONS=1` when re-running preflight if you already ran ensure-all-schemas and don't want to re-run migrations.

## Rebuild and deploy after code changes

After changing **api-gateway**, **social-service**, **analytics-service**, or **python-ai-service** (or any other service), rebuild images and roll out so the suite sees the new code:

1. **Build and load**
   - **Colima:** Run `./scripts/build-and-rollout-colima.sh` to build all `:dev` images and rollout restart deployments. Or let preflight (step 2e) build missing images when `PREFLIGHT_ENSURE_IMAGES=1` (default). To build only (no rollout): build each service with `docker build -t <service>:dev -f services/<service>/Dockerfile .`.
   - **Kind:** Run `./scripts/build-and-load.sh` (default cluster `h3`). Pass cluster name if different: `./scripts/build-and-load.sh <cluster>`.
   - **k3d:** Build images as above, then `k3d image import <name>:dev -c record-platform` for each, or use your registry flow.

2. **Restart deployments** so pods pick up the new image:

   ```bash
   kubectl rollout restart deployment api-gateway social-service analytics-service python-ai-service -n record-platform
   kubectl rollout status deployment api-gateway social-service analytics-service python-ai-service -n record-platform --timeout=120s
   ```

   Or restart only the ones you changed, e.g. `kubectl rollout restart deployment api-gateway -n record-platform`.

3. **Re-run the suite** (e.g. `./scripts/test-microservices-http2-http3.sh` or the full preflight one-liner).

## Run full preflight + k6 + all suites (no pgbench)

To run **everything except pgbench** (steps 0–7: context, API, reissue, MetalLB, Caddy, scale, strict TLS, all test suites, k6 phases; step 8 pgbench skipped):

**Colima** (LoadBalancer so host can reach Caddy; HTTP/3 works):

```bash
METALLB_ENABLED=1 RUN_PGBENCH=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "preflight-no-pgbench-$(date +%Y%m%d-%H%M%S).log"
```

With `METALLB_ENABLED=1` the script will use Colima (REQUIRE_COLIMA=1 is set automatically) and install MetalLB so Caddy gets a LoadBalancer IP. Ensure Colima is running and the host can reach the LB pool (e.g. `192.168.64.240-192.168.64.250` on the VM network, or add a route if using a different pool; see “Colima + MetalLB: host → LB IP” above).

**k3d** (MetalLB on k3d; no Colima):

```bash
METALLB_ENABLED=1 REQUIRE_COLIMA=0 RUN_PGBENCH=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "preflight-no-pgbench-$(date +%Y%m%d-%H%M%S).log"
```

Optional: `RUN_SHOPPING_SEQUENCE=1` to run the shopping order-number sequence before suites; `SUITE_TIMEOUT=0` for no per-suite time cap.

## One-liner (recommended)

From the repo root:

```bash
cd /Users/tom/record-platform && COLIMA_START=1 RUN_FULL_LOAD=1 KILL_STALE_FIRST=1 PGBENCH_PARALLEL=1 bash ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "preflight-full-$(date +%Y%m%d-%H%M%S).log"
```

The script re-execs with bash if invoked by zsh/sh so it behaves correctly in pipelines. Using `bash ./scripts/...` in the one-liner guarantees bash even if your default shell or terminal profile changed (e.g. after disabling Docker/Kind as default).

This runs:

- **Suites:** auth, baseline, enhanced, adversarial, rotation, standalone, tls-mtls, social
- **k6 phases:** read, soak, sweep, limit, max, and HTTP3 (if xk6-http3 is built); **protocol comparison** (HTTP/2 vs HTTP/3) when `K6_PROTOCOL_COMPARISON=1` — logs under `bench_logs/suite-logs-<timestamp>/`
- **pgbench:** all 8 DBs in parallel (records, social, auth, shopping, listings, analytics, auction_monitor, python_ai). **Postgres is external** (Docker Compose on host ports 5433–5440), not in-cluster; step 3b3 brings up Docker Postgres; suites and pgbench connect to `localhost:5433` etc.
- **Summary:** `bench_logs/PREFLIGHT_SUMMARY.md` and `bench_logs/preflight-results.json` (for the observation deck)
- **Packaged run folder:** All artifacts for the run go into **`bench_logs/preflight-<timestamp>/`**: suite logs, per-DB pgbench logs, **EXPLAIN (ANALYZE, BUFFERS)** for all 8 DBs/schemas, combined pgbench log, PREFLIGHT_SUMMARY.md, preflight-results.json
- **Telemetry:** Control-plane telemetry is captured automatically (apiserver metrics every 8s during run; post-run snapshot and raw `/metrics`). Paths are printed at exit: `telemetry-during-<ts>.log`, `telemetry-after-<ts>.txt`, `raw-metrics-<ts>.txt` in repo root. Set `PREFLIGHT_TELEMETRY=0` to disable.

Env vars set automatically when `RUN_FULL_LOAD=1`:

- `PREFLIGHT_RUN_DIR` → `bench_logs/preflight-<timestamp>` (one folder per run)
- `SUITE_LOG_DIR` → `bench_logs/preflight-<ts>/suite-logs`
- `K6_CA_ABSOLUTE` → `certs/dev-root.pem`
- `K6_PHASES` → `read,soak,sweep,limit,max`
- `K6_HTTP3` → `1`

Override if you want, e.g. `SUITE_LOG_DIR=/tmp/k6` before the command.

**Curl and chaos guardrails (single-node / Colima):** Preflight sets `CURL_MAX_TIME=15` and `CURL_CONNECT_TIMEOUT=3` so health checks are less likely to hit exit 28 (timeout) under load. Telemetry is capped (default 8 min / 60 iterations) to avoid API saturation. For chaos/rotation: set `CHAOS_CPU_GUARDRAIL=1` so the k6 chaos job is skipped when node CPU &gt; 80% or memory &gt; 85%; set `CHAOS_LOW_START_RATE=1` to start k6 at 200 req/s (H2=120, H3=80) instead of 320+180. Packet capture uses a 1s warmup after starting tcpdump (`CAPTURE_WARMUP_SECONDS=1`) so short requests are not missed.

**gRPC in MetalLB mode:** When using MetalLB (TARGET_IP + PORT=443), gRPC is **internal only** (host → LB = Caddy HTTP; gRPC = in-cluster → Envoy ClusterIP → services). The suite uses an in-cluster ephemeral grpcurl pod to validate Envoy routing; host NodePort/port-forward gRPC tests are skipped. Envoy config includes an explicit route for `grpc.health.v1.Health` and 15s timeouts. Set `GRPC_USE_IN_CLUSTER=1` to force in-cluster gRPC even when not using the LB IP.

---

## If preflight exits right after "Stale processes cleared"

The script must run under **bash**. If it stops after step 0 and you get the prompt back, run the one-liner with **`bash`** in front of the script (as in the block above). That avoids zsh/sh interpreting the script when your default shell or terminal profile changed (e.g. after disabling Docker/Kind as default).

---

## If preflight gets stuck at "Waiting for API server"

6443 is set up automatically. If it still fails: run `colima status` and if needed `colima start --with-kubernetes`, then re-run the one-liner. As a one-off you can run `./scripts/colima-forward-6443.sh` and retry.

---

## If Colima VM fails to start (fatal / "error starting vm")

The script will **once** try to recover by running `colima stop`, `colima delete -f`, then `colima start --with-kubernetes`. Set `COLIMA_RECOVER=0` to skip that.

If Colima still doesn’t start:

1. Check the VM log: `cat ~/.colima/_lima/colima/ha.stderr.log`
2. **Use VZ and a clean instance:** The existing instance may have been created with QEMU, which can break VZ. Do a clean start with VZ only:
   ```bash
   colima delete -f
   colima start --with-kubernetes --vm-type vz
   ```
3. If you see QEMU “hvf is not supported” or “not signed”, the QEMU binary can’t use HVF on Apple Silicon. Prefer VZ (step 2). To fix QEMU instead, see [lima#1742](https://github.com/lima-vm/lima/issues/1742).
4. After Colima is running, run the one-liner again (use `COLIMA_START=0` if Colima is already up).

---

## k3d (not Colima)

When the context is **k3d** (e.g. `k3d-record-platform`), preflight does **not** use Colima or the 6443 tunnel. Step **3c0a** restarts k3d nodes so k3s picks up the registry config; step **3c0b** then waits for the k3d API to stabilize (default up to 5 min, progress every 30s). How long it took is printed and written to **`bench_logs/k3d-stabilization-last.txt`** (e.g. `stable_after_s=120` or `did_not_stabilize elapsed_s=300`). If the API does not stabilize in time, MetalLB/Caddy applies may fail; increase **`PREFLIGHT_K3D_API_STABILIZE_SLOTS`** (e.g. 90 for 7.5 min) or run `kubectl get nodes` and re-run preflight once the API is up.

---

## HTTP/3 and MetalLB (k3d)

- **Step 4e** checks HTTP/3 from the host to NodePort 127.0.0.1:30443 using `record.local` + `--resolve`. On macOS, NodePort UDP often does not work from the host, so you may see code **000** — that is expected and non-fatal.
- **Step 4f** verifies HTTP/3 **in-cluster** (pod → Caddy via MetalLB/LB IP). That is the authoritative check for “HTTP/3 works” in preflight; suites can use HTTP/2 from the host or in-cluster QUIC.
- So: **in-cluster HTTP/3 = pass**; host NodePort QUIC is best-effort and not required for preflight to succeed.

## Colima + MetalLB: host → LB IP and HTTP/3 (one-time route)

When using **Colima** with **bridged** networking and MetalLB (e.g. pool 192.168.5.240–192.168.5.250), the Mac is not on 192.168.5.x. To reach the Caddy LoadBalancer from the host and have **all HTTP/3 tests pass** in preflight/suites:

1. **One-time route** (use **IPv4** node IP only — nodes often have an IPv6 InternalIP too, and `route` will fail with "bad address" if you pass it):
   ```bash
   NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
   [[ -n "$NODE_IP" ]] && sudo route -n add 192.168.5.0/24 "$NODE_IP"
   ```
   Or use a known IPv4 from `kubectl get nodes -o wide`: `sudo route -n add 192.168.5.0/24 192.168.64.7`
2. **Verify:** `curl -k -sS -o /dev/null -w '%{http_code}' --http2 --resolve record.local:443:192.168.5.240 https://record.local/_caddy/healthz` → **200**
3. **HTTP/3** (use Homebrew curl):  
   `NGTCP2_ENABLE_GSO=0 /opt/homebrew/opt/curl/bin/curl -k -sS -o /dev/null -w '%{http_code}' --http3-only --resolve record.local:443:192.168.5.240 https://record.local/_caddy/healthz` → **200**
4. Run preflight with MetalLB: `REQUIRE_COLIMA=1 METALLB_ENABLED=1 ./scripts/run-preflight-scale-and-all-suites.sh`. Step 3c1b (MetalLB verify) will see the LB IP reachable and write `/tmp/metallb-reachable.env` with `REACHABLE_LB_IP=192.168.5.240` and `PORT=443`, so **run-all-test-suites** and baseline/enhanced use the LB IP for HTTP/2 and HTTP/3 (no socat/127.0.0.1:8443 needed).

Without the route, verification can still use the no-sudo forward (127.0.0.1:8443 → NodePort) for HTTP/2, but **QUIC to 127.0.0.1:8443 often fails**; the route is the supported path for host HTTP/3.

**Colima + MetalLB + FRR/BGP already installed:** If you ran `./scripts/install-metallb-colima.sh` (with optional `METALLB_POOL=192.168.5.240-192.168.5.250`), pool, L2, FRR, and BGPPeer are in place. Full verify: `./scripts/verify-metallb-and-traffic-policy.sh`. For **real asymmetric** (two node→LB paths) see **docs/COLIMA_REAL_ASYMMETRIC_PLAN.md** (requires 2+ nodes).

## Colima full preflight (MetalLB + Kafka + Caddy H3 + HTTP/3 + xk6)

With Colima as primary, MetalLB + FRR/BGP installed, and Kafka/Caddy working:

1. **Optional pool** (if not already applied): `METALLB_POOL=192.168.5.240-192.168.5.250 ./scripts/install-metallb-colima.sh` (installs pool, L2, and FRR+BGP if no BGPPeer).
2. **Route** so host can reach LB IP (IPv4 only — node may have IPv6 InternalIP):
   `NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1); [[ -n "$NODE_IP" ]] && sudo route -n add 192.168.5.0/24 "$NODE_IP"`
3. **Kafka** (for suites): `docker compose up -d zookeeper kafka` (and ensure `kafka-ssl-secret` exists via reissue or `./scripts/kafka-ssl-from-dev-root.sh`).
4. **Run preflight** (full: pgbench + k6 + xk6 HTTP/3 + all suites):
   ```bash
   REQUIRE_COLIMA=1 METALLB_ENABLED=1 RUN_FULL_LOAD=1 COLIMA_START=1 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "preflight-colima-$(date +%Y%m%d-%H%M%S).log"
   ```
   Step 6d builds **xk6-http3** if missing (`K6_HTTP3=1`, `K6_HTTP3_PHASES=1`). Baseline/enhanced use **--http3-only** where applicable; k6 phases run HTTP/2 and xk6 HTTP/3.

## Host tools (optional, run once)

Preflight and MetalLB verification use **host** curl (for HTTP/3), tcpdump, tshark, htop, etc. To install them permanently so they are not needed in-pod:

```bash
./scripts/install-preflight-tools.sh
```

This installs Homebrew curl (HTTP/3), htop, wireshark (tshark), and optionally valgrind. Scripts already set `PATH` to prefer `/opt/homebrew/bin` for curl.

---

## Known failures and warnings

See **`scripts/TEST-FAILURES-AND-WARNINGS.md`** for a catalog of expected warnings (e.g. auth MFA/OAuth/email, Envoy gRPC on Colima, shopping duplicate key fix) and what to do.

---

## Example: k3d + MetalLB + suites only (no pgbench, shopping sequence)

This is the “preflight per se” run: k3d cluster, MetalLB for Caddy LoadBalancer, all test suites, no pgbench, no per-suite time cap, shopping order-number sequence applied before suites, optional Colima L2 verification.

```bash
SUITE_TIMEOUT=0 METALLB_ENABLED=1 REQUIRE_COLIMA=0 RUN_PGBENCH=0 RUN_SHOPPING_SEQUENCE=1 METALLB_VERIFY_COLIMA_L2=1 ./scripts/run-preflight-scale-and-all-suites.sh
```

| Env | Effect |
|-----|--------|
| `SUITE_TIMEOUT=0` | No per-suite time cap; each suite runs to completion (default with RUN_FULL_LOAD=0 is 3600s). |
| `METALLB_ENABLED=1` | Install MetalLB; Caddy gets a LoadBalancer service; step 3c1 MetalLB verify runs on k3d. |
| `REQUIRE_COLIMA=0` | Use **k3d** for preflight and suites (no Colima k3s for heavy steps). |
| `RUN_PGBENCH=0` | Skip step 8 (pgbench); exit after step 7 (suites). RUN_FULL_LOAD stays 0 so no k6 phases. |
| `RUN_SHOPPING_SEQUENCE=1` | Step **6f** runs `ensure-shopping-order-number-sequence.sh` before suites (fresh order_number for Test 13c/13j5). |
| `METALLB_VERIFY_COLIMA_L2=1` | After 3c1b (MetalLB verify on k3d), step **3c1c** runs real L2/ARP (and BGP if enabled) on **Colima** only. Colima must be running (`colima start --with-kubernetes`); if not, 3c1c is skipped with a warning and preflight continues. |

**What to watch**

1. **Step 3** — API server ready (k3d: ENSURE_CAP=180s).
2. **Step 3b0** — k3d: wait for **all expected nodes (2) to be Ready** (max PREFLIGHT_K3D_NODES_READY_WAIT=120s). Ensures the 2-node cluster is fully ready before reissue/MetalLB.
3. **Step 3a** — Reissue CA + leaf, Kafka SSL, remove in-cluster DB/Kafka (Phase 1B; write lock if enabled).
4. **Step 3c0 / 3c0b** — If k3d node restart runs (registry), API stabilize wait (default 90×5s slots). After 3c0b success, all nodes Ready is re-checked before 3c1 (MetalLB). See `bench_logs/k3d-stabilization-last.txt` if it’s slow.
5. **Step 3c1** — MetalLB install; **3c1b** MetalLB verify on k3d (when `METALLB_VERIFY_COLIMA_L2=1`, “advanced” verify is skipped on k3d); **3c1c** Colima L2 only if Colima context is available.
6. **Step 3c2** — Caddy deploy + **LoadBalancer** service (not NodePort); Caddy gets EXTERNAL-IP from MetalLB.
7. **Step 4d / 4e / 4f** — Caddy strict TLS; 4e (host NodePort HTTP/3) may show 000 on macOS (non-fatal); 4f in-cluster HTTP/3 is the one that must pass.
8. **Step 6b / 6b2** — 6b: all services + Caddy + Envoy ready (wait-for-all-services-ready.sh). 6b2: two-node cluster health (nodes Ready) and pod summary before step 7.
9. **Step 6f** — Shopping order_number sequence (only when RUN_SHOPPING_SEQUENCE=1).
10. **Step 7** — `run-all-test-suites.sh` (auth, baseline, enhanced, adversarial, rotation, standalone, tls-mtls, social); SUITE_TIMEOUT=0 so no suite is killed by time.

**Get ready first:** `./scripts/ensure-ready-for-preflight.sh` (cluster up, external Postgres/Redis/Kafka, **all app images built and in k3d registry**). When **Colima**, step 2e ensures **record-platform-shopping-service:latest** and **record-platform-listings-service:latest** (K8s deploy uses these); other services use `:dev`. When k3d, step 6 checks local `:dev` images and registry catalog; run `./scripts/build-and-push-dev.sh` then `./scripts/push-dev-images-to-registry.sh` if any are missing.

---

## Optional env vars

| Variable | Effect |
|----------|--------|
| `RUN_FULL_LOAD=0` | Suites only; no pgbench, no k6 phases |
| `RUN_SUITES=0` | Skip test suites (preflight + scale + TLS only) |
| `SKIP_API_SERVER_CHECK=1` | Skip step 3 API check (use only if Colima is known good) |
| `PGBENCH_PARALLEL=0` | Run pgbench sequentially (slower) |
| `PREFLIGHT_RUN_DIR=/path/to/dir` | Override packaged output folder (default: `bench_logs/preflight-<timestamp>`) |
| `PREFLIGHT_TELEMETRY=0` | Disable control-plane telemetry (during-run + post-run snapshot). Default 1. |
| `TELEMETRY_PERF=1` | Record `perf -g -a` during run (saved as `perf-<ts>.data`; analyze with `perf report -i <file>`). |
| `TELEMETRY_HTOP=1` | Run one `htop --batch` snapshot after preflight. |
| `PREFLIGHT_MAIN_LOG=./preflight.log` | Tee all preflight output to one file; Ctrl+C leaves it for analysis. |
| `run-preflight-with-telemetry.sh` | Thin wrapper: sets `PREFLIGHT_MAIN_LOG` and `RUN_FULL_LOAD=0` (preflight-only); telemetry is built into the main script. |
| `METALLB_ENABLED=1` | Install MetalLB and use LoadBalancer for Caddy. On k3d, step 3c0b waits for API to stabilize after node restart; Caddy apply and 3f restarts are retried on failure. Before 3c1b (MetalLB verification), preflight waits for caddy-h3 rollout (see `PREFLIGHT_CADDY_ROLLOUT_WAIT`). |
| `METALLB_VERIFY_COLIMA_L2=1` | After 3c1b (MetalLB verify on k3d), run step 3c1c: real L2/ARP (and BGP) on Colima only. Colima must be running; preflight and suites stay on k3d. |
| `SUITE_TIMEOUT=0` | No per-suite time cap (suites run to completion). Default when not set is 3600s in step 7. |
| `RUN_SHOPPING_SEQUENCE=1` | Step 6f runs ensure-shopping-order-number-sequence before suites (fresh order_number for shopping tests). |
| `PREFLIGHT_K3D_EXPECTED_NODES=2` | k3d: require this many nodes; step 3b0 and post-3c0b wait until all are **Ready** (default 2 for 2-node cluster). |
| `PREFLIGHT_K3D_NODES_READY_WAIT=120` | k3d: max seconds to wait for all nodes Ready (default 120). Set 0 to skip. Ensures both nodes are Ready before reissue/MetalLB/applies. |
| `PREFLIGHT_ENSURE_IMAGES=1` | Colima: step 2e builds **record-platform-shopping-service:latest** and **record-platform-listings-service:latest** if missing, then other app `:dev` images. k3d: verifies required app images in registry (127.0.0.1:5000); exit 1 if any missing. Set 0 to skip. |
| `ENSURE_IMAGES=1` | In ensure-ready-for-preflight.sh: when k3d, require all app :dev images locally and in registry (step 6). Set 0 to skip. |
| `PREFLIGHT_CADDY_ROLLOUT_WAIT=120` | Seconds to wait for caddy-h3 rollout before MetalLB verification (3c1b). Default 120. If Caddy is slow, increase or check pod events. |

**Troubleshooting:** If MetalLB verify passes when run standalone but fails inside preflight, or you see 3 Caddy pods (1 Pending) or services stuck 0/1 Ready, see **docs/PREFLIGHT_METALLB_VERIFY_ORDER.md** (order fix: 3c2 Caddy before 3c1b verify; Caddy maxSurge; 0/1 = DB/Kafka/Redis).
| **Step 6b** | wait-for-all-services-ready.sh: all 9 record-platform deployments 1/1 Ready; when `WAIT_CADDY_ENVOY=1` (default), also Caddy (ingress-nginx) 2/2 and Envoy (envoy-test) 1/1. |
| **Step 6b2** | Cluster health: on k3d, require `PREFLIGHT_K3D_EXPECTED_NODES` (default 2) nodes Ready; then print pod summary (record-platform, ingress-nginx, envoy-test). Fail if nodes not all Ready. |
| `WAIT_CADDY_ENVOY=1` | In wait-for-all-services-ready.sh: also wait for Caddy 2/2 and Envoy 1/1 (default). Set 0 to only wait for record-platform services. |
| Step 6e | ensure-tcpdump runs once; if any pod reports "timed out", it is retried once so baseline/enhanced/rotation capture can skip per-pod install. |
| `SUITE_LOG_DIR=/tmp/k6` | Put k6/suite logs in this dir |
| `K6_PROTOCOL_COMPARISON=0` | Skip HTTP/2 vs HTTP/3 comparison (default 1 when RUN_FULL_LOAD=1) |
| `PGBENCH_RANDOMIZED=0` | Records pgbench: single query only (default 1 = 5 random query patterns) |
| `REAL_COLD_CACHE=0` | Skip cache eviction after CHECKPOINT in cold phase (default 1) |
| `COLIMA_RECOVER=0` | Don't try stop/delete/start when Colima VM fails to start |
| `COLIMA_START=0` | Don’t start Colima; fail if it’s not already running |
