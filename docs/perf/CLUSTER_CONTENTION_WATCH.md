# Cluster contention — prove it & capture to files

When services look **healthy in isolation** but **degrade in the full suite**, treat **cross-test resource contention** as a first-class hypothesis (especially on **Colima**: virtiofs, VM scheduling, bursty k6).

This doc ties together **manual watching**, **automatic file logs**, and **suite pacing**.

---

## What to watch (human checklist)

During a long run (`run-preflight-scale-and-all-suites.sh` or `run-all-test-suites.sh`):

| Signal | Command | Rough threshold |
|--------|---------|-----------------|
| Node CPU | `kubectl top nodes` | sustained **> ~80%** |
| Node memory | same | **> ~80%** |
| Hot pod | `kubectl top pods -n off-campus-housing-tracker` | **≥ ~1000m** CPU in a sample (≈1 core) |
| Postgres | pods with `postgres` in name | CPU spike vs baseline |
| Envoy | `kubectl top pods -n envoy-test` | spike during edge load |

**Messaging / analytics** “failure modes” under contention often look like: **dropped iterations** (CAR), **slow p95**, **low RPS** — not always a logic bug.

---

## 1) Second terminal — continuous log to disk

```bash
cd /path/to/Off-Campus-Housing-Tracker
./scripts/perf/watch-cluster-contention.sh
```

- Writes **`bench_logs/cluster-contention-watch-<timestamp>.log`**
- Poll interval: **`CONTENTION_WATCH_INTERVAL_SEC`** (default **8**)
- Custom path: **`CONTENTION_WATCH_LOG=/tmp/my-watch.log ./scripts/perf/watch-cluster-contention.sh`**

Non-interactive sample (e.g. CI helper):

```bash
CONTENTION_WATCH_MAX_ITER=30 CONTENTION_WATCH_INTERVAL_SEC=10 ./scripts/perf/watch-cluster-contention.sh
```

---

## 2) Automatic snapshots during k6 (preflight / suites)

Hooks in **`scripts/lib/k6-suite-resource-hooks.sh`** already:

- **`kubectl top` snapshot** after each block; optional node CPU fail (`K6_SUITE_FAIL_ON_NODE_CPU`)
- **Gateway drain** then **post-drain sleep** then **optional stray-`k6` kill** then **cooldown** — order matters for **orchestration concurrency bleed** (shared **api-gateway**): wait until matching pod CPU &lt; **`K6_SUITE_GATEWAY_DRAIN_MAX_MILLICORES`** (default **150**), then **`K6_SUITE_POST_DRAIN_SLEEP_SEC`** (default **10s** in **`run-housing-k6-edge-smoke.sh`**), then **`K6_SUITE_KILL_K6_AFTER_BLOCK`** (default **1** there — `pkill -9 -x k6`; set **0** if another terminal runs k6). Requires **metrics-server** for drain.
- **`sleep`** after that chain (`K6_SUITE_COOLDOWN_SEC`, extra after CAR)
- Optionally **`kubectl rollout restart deployment/envoy-test`** after CAR tests (`K6_SUITE_RESTART_ENVOY_AFTER_CAR=1`)
- **Append the same `kubectl top` text** to a file when **`K6_SUITE_RESOURCE_LOG`** is set
- Optional **`K6_SUITE_POST_KILL_K6_SLEEP_SEC`** — extra sleep after the kill step

**Edge smoke** also defaults **`K6_ORCHESTRATION_VU_SCENARIO=1`**: **`k6-messaging.js`** and **`k6-media-health.js`** use **ramping-vus** instead of **constant-arrival-rate** so the orchestration suite is less likely to drop iterations and pile VUs against the gateway. Set **`K6_ORCHESTRATION_VU_SCENARIO=0`** to restore CAR for stress-style runs.

### Auto log path (default)

**Preflight step 7a** and **`run-all-test-suites.sh`** (when `RUN_K6=1`) set automatically unless disabled:

```bash
K6_SUITE_RESOURCE_LOG_AUTO=0   # stdout only; no dedicated file
```

Default file pattern: **`bench_logs/k6-suite-resources-<timestamp>.log`**

Override explicitly:

```bash
export K6_SUITE_RESOURCE_LOG="$PWD/bench_logs/my-k6-top.log"
```

### Console warnings

With defaults, hooks also **stderr-warn** when:

- Any node **CPU%** or **MEMORY%** ≥ **`K6_SUITE_WARN_NODE_CPU` / `K6_SUITE_WARN_NODE_MEM`** (default **80**)
- Any housing pod ≥ **~1000m** CPU in that snapshot

### Aggressive stability (disruptive)

```bash
K6_SUITE_STABILITY_AGGRESSIVE=1 ./scripts/run-preflight-scale-and-all-suites.sh
```

Forces **Envoy restart after each constant-arrival-rate** k6 block (unless you already set `K6_SUITE_RESTART_ENVOY_AFTER_CAR=0`).

### Optional: drop page cache inside Colima VM (harsh)

**Lab only** — hurts performance for everyone on that VM:

```bash
K6_SUITE_COLIMA_DROP_CACHES=1
```

Runs `sync` + `drop_caches` via **`colima ssh`** **before** each k6 block (when hooks are wired).

### Optional: snapshot before each k6

```bash
K6_SUITE_LOG_TOP_BEFORE=1
```

---

## 3) Related

- [TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md](./TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md) — tail vs contention narrative + isolation matrix script
- [LISTINGS_HTTP_TIMING.md](./LISTINGS_HTTP_TIMING.md) — service-side timing vs DB
- `scripts/perf/run-k6-cross-service-isolation.sh` — one script at a time + `cluster-snapshots.log`

---

## Why listings “got faster” after a rollout

Restarting a deployment resets **pools**, **heap fragmentation**, and **event loop** idle state — a real effect, separate from “logging fixed the bug.” Use file logs + isolation runs to separate **contention** from **code regressions**.
