# Tail latency & cross-service performance (load lab)

This doc ties together **two active focus areas** for the team:

1. **Tail latency optimization (advanced)** — p99 / max / “5s class” stalls: measure, attribute (DB vs gateway vs pool vs event loop), then tune or orchestrate around them.
2. **Cross-service performance analysis** — how **one k6 block** (gateway, auth, listings, messaging, analytics, …) affects **the next** when `run-preflight-scale-and-all-suites.sh` or the k6 grid runs **back-to-back**.

It is the written counterpart to: *listings healthy in isolation, noisy inside the full suite* — that pattern is **cluster contention and orchestration**, not proof of a listings logic bug.

---

## Evidence we already validated (listings example)

Under **isolated** k6 against listings health (edge → gateway → listings):

- p95 ~ tens of ms, p99 ~ low hundreds of ms, max sub-second class, **0 failures**
- With **`LISTINGS_HTTP_TIMING`** + pool logs: **`waiting=0`** on the pg pool → no pool starvation signal from listings

**Conclusion for listings in isolation:** service + DB path + pool + event loop look **healthy**; no mandatory “fix listings code” signal from that run.

**Same service inside the big suite** can still look worse later in the run.

**Conclusion:** degradation is consistent with **systemic contention** when many k6 scenarios run **sequentially** (and some use **constant-arrival-rate**, high VUs, bursts). Later tests **inherit** CPU, memory pressure, connection state, and hypervisor scheduling from earlier work.

---

## Hypotheses when suite > standalone (checklist)

When listings (or analytics, messaging, …) is slow **only after** other tests, consider:

| # | Layer | What to watch |
|---|--------|----------------|
| 1 | Node / VM | **CPU** sustained high — `kubectl top nodes` |
| 2 | Pods | **Memory** pressure — `kubectl top pods -n off-campus-housing-tracker` |
| 3 | Another service | Event loop / GC on **api-gateway**, **envoy**, **caddy** under prior load |
| 4 | Envoy | **Connection pool** / upstream reuse — optional `K6_SUITE_RESTART_ENVOY_AFTER_CAR=1` (disruptive; see hooks) |
| 5 | Host / VM | **Socket** exhaustion, ephemeral port reuse |
| 6 | Colima | **virtiofs + Virtualization.Framework** — bursty IO/network not identical to bare metal |
| 7 | k3s | **containerd** pressure under image churn + many short-lived connections |

**Prove it during a suite run:** second terminal:

```bash
kubectl top nodes
kubectl top pods -n off-campus-housing-tracker
# optional:
kubectl top pods -n envoy-test
```

Watch for CPU/memory **> ~80%**, any pod **> ~1 core** sustained, Postgres or Envoy spikes.

---

## 1. Tail latency optimization (advanced)

**Goal:** Separate **tail** (p99, max) from **median** behavior and attribute sources.

### 1.1 Runbook (do this in order)

1. **Baseline under isolation** — Run the service’s k6 script alone (e.g. `k6-listings-health.js` or the [isolation matrix](#22-isolation-matrix-script) for the full grid). Record p95/p99/max and failures.
2. **Compare to suite** — Run the same script **after** the full preflight/grid (or note position in `run-housing-k6-edge-smoke.sh`). If tails only appear in the suite, treat as **contention** first (section 2), not a pure code bug.
3. **DB vs HTTP wall time** — For listings search/browse: enable `LISTINGS_HTTP_TIMING=1` (+ optional `LISTINGS_HTTP_SEARCH_DB_MIN_MS`, pool stats). See [LISTINGS_HTTP_TIMING.md](./LISTINGS_HTTP_TIMING.md).
4. **Classify the tail:**
   - **DB phase log ≪ total request log** → proxy / gateway / JSON / event loop / client / scheduling.
   - **Flat ~5s** → timeout alignment (Envoy, gateway HTTP client, gRPC deadlines). Cross-check service + edge logs.
   - **`waiting > 0` on pg pool** → pool sizing / Postgres `max_connections` (tune carefully).
5. **Query path** — If DB is suspect: `./scripts/perf/run-all-explain.sh` (host Postgres **5441–5448**). Compare with k6 tail when DB is idle vs under suite load.
6. **Regressions** — Lock thresholds in `scripts/load/k6-*.js` (`http_req_duration` p95/p99/max). Tighten only when isolation baseline is stable.

### 1.2 Tooling map

| Mechanism | Where | Use |
|-----------|--------|-----|
| Per-request HTTP timing + **SLOW_TIMEOUT_CLASS** (≥5s class) | `LISTINGS_HTTP_TIMING=1` — [LISTINGS_HTTP_TIMING.md](./LISTINGS_HTTP_TIMING.md) | End-to-end time vs DB-only search log lines |
| pg pool **`waiting`** | `LISTINGS_HTTP_POOL_STATS_MS` | Starvation under load |
| k6 thresholds | `scripts/load/k6-*.js` | Regressions on p95/p99/max |
| EXPLAIN + buffers | `scripts/perf/run-all-explain.sh`, `sql/explain-*.sql` | Query plan / DB tail when DB is suspect |
| One-shot perf report | `./scripts/perf/run-perf-full-report.sh` | EXPLAIN + k6 → `bench_logs/perf-report-*/PERF_REPORT.md` |

### 1.3 Sustainable load (when tails are environmental)

- Reduce **constant-arrival-rate** `rate` or **`preAllocatedVUs` / `maxVUs`** in the hottest scripts (`k6-messaging.js`, `k6-media-health.js`, `k6-reads.js` rate scenario, `k6-limit-test-comprehensive.js`).
- Prefer **longer** `K6_SUITE_COOLDOWN_SEC` / `K6_SUITE_CAR_EXTRA_SEC` in dev Colima over scaling replicas for the lab.
- **Optional:** `K6_SUITE_RESTART_ENVOY_AFTER_CAR=1` to test whether Envoy connection reuse amplifies tails (disruptive).

**Advanced (optional, not automated):** dropping page cache inside the Linux VM (`drop_caches`) is a **harsh** experiment for cold-path tails — use only in a dedicated lab, not default CI.

---

## 2. Cross-service performance analysis

**Goal:** Understand **order effects**: which prior test **poisons** the next (CPU, connections, warm pools, kernel state).

### 2.1 Built-in suite hooks (preflight / grid)

| Mechanism | Where | Default |
|-----------|--------|---------|
| **Cooldown** after every k6 block | `scripts/lib/k6-suite-resource-hooks.sh` | `K6_SUITE_COOLDOWN_SEC=15` |
| **Extra cooldown** after **constant-arrival-rate** style tests | same | `K6_SUITE_CAR_EXTRA_SEC=20` |
| **`kubectl top` snapshot** after each block | same | `K6_SUITE_LOG_TOP=1` |
| **Fail if node CPU too high** | same | `K6_SUITE_FAIL_ON_NODE_CPU=1`, `K6_SUITE_NODE_CPU_MAX=85` |
| **Optional Envoy restart** after CAR tests | same | `K6_SUITE_RESTART_ENVOY_AFTER_CAR=0` (set `1` deliberately) |

**Wired into:** `run-housing-k6-edge-smoke.sh`, `run-k6-phases.sh`, `run-all-test-suites.sh`, and post–in-cluster k6 in `run-preflight-scale-and-all-suites.sh` (see script headers for `K6_SUITE_*`).

**Live correlation during a long suite:** second terminal — `kubectl top nodes` and `kubectl top pods -n off-campus-housing-tracker` (and `envoy-test`) while preflight runs.

### 2.2 Isolation matrix script

**Purpose:** Run the **same** edge k6 scripts as the smoke grid **one at a time** with longer cooldowns and **append** `kubectl top` before/after each run to `cluster-snapshots.log`, plus per-script `--summary-export` JSON and a rollup `latency-report.md`.

```bash
cd /path/to/Off-Campus-Housing-Tracker
SSL_CERT_FILE=$PWD/certs/dev-root.pem ./scripts/perf/run-k6-cross-service-isolation.sh
```

**Outputs** (under `bench_logs/k6-cross-service-<timestamp>/`):

| File | Contents |
|------|-----------|
| `*-summary.json` | k6 metrics per script |
| `latency-report.md` / `latency-graph.html` | Aggregated p50/p95/p99/max (via `aggregate-k6-summaries.py`) |
| `cluster-snapshots.log` | Timestamped `kubectl top nodes` + housing + envoy pods around each run |
| `MANIFEST.txt` | Run order + which scripts used CAR extra cooldown |

**Compare:** If `latency-report.md` is **clean** here but **noisy** in `run-housing-k6-edge-smoke.sh` / preflight **7a**, you have evidence for **cross-test contention**, not a single-service regression.

**Tune:** `K6_ISO_POST_COOLDOWN_SEC`, `K6_ISO_CAR_EXTRA_SEC`, `K6_ISO_SKIP_JWT`, `K6_ISO_SKIP_ANALYTICS_FEEL`, per-stage durations (`K6_ISO_BOOKING_DURATION`, …).

### 2.3 Broader grid (more scripts)

`scripts/load/run-k6-all-services.sh` runs a **longer** list (includes notification, listings ramp script, etc.) with summaries but **without** inter-test cluster snapshots. Use it for rollup charts; use **`run-k6-cross-service-isolation.sh`** when you need **snapshots + pacing** aligned to the smoke grid.

### 2.4 Why messaging / analytics looked “bad” in the suite

- **Messaging:** constant-arrival-rate patterns, many VUs → competes for CPU and connections with everything else.
- **Analytics:** slow p95 + low RPS often reads as **resource competition** or cold dependencies (e.g. Ollama), not only “analytics code is wrong.”

**Strategy (agreed direction):** prefer **orchestration and pacing** (cooldowns, visibility, sustainable CAR rates) over blindly **scaling replicas** for a dev Colima lab.

---

## Why listings “got faster” after enabling timing logs

Rolling out diagnostics usually implied a **deployment restart**, which resets:

- process **connection pools**
- **heap** / fragmentation
- **event loop** idle state

So a one-off improvement after “turning logging on” can partly be **reset side effects** — still worth doing, but not a substitute for fixing suite pacing.

---

## Next steps (team backlog)

1. **Isolation matrix** — ✅ scripted: `./scripts/perf/run-k6-cross-service-isolation.sh`. Manually diff `latency-report.md` vs full grid; scan `cluster-snapshots.log` for CPU spikes **after** specific script names to label “poisoner” tests.
2. **Sustainable RPS** — lower **constant-arrival-rate** or VUs on the heaviest scripts until p99 stabilizes under full grid (see §1.3).
3. **Envoy / gateway** — correlate tail spikes with Envoy stats or gateway logs when `K6_SUITE_RESTART_ENVOY_AFTER_CAR=1` changes outcomes.
4. **Colima limits** — document expected ceiling; treat long suite as **load lab**, not production SLO proof.

---

## Related docs

- [CLUSTER_CONTENTION_WATCH.md](./CLUSTER_CONTENTION_WATCH.md) — **`watch-cluster-contention.sh`** (pipe top to a file) + **`K6_SUITE_RESOURCE_LOG`** auto-append + Envoy / drop_caches toggles.
- [LISTINGS_HTTP_TIMING.md](./LISTINGS_HTTP_TIMING.md) — enable diagnostics, rebuild image, Colima load.
- [LISTINGS_SEARCH.md](./LISTINGS_SEARCH.md) — SQL / search path.
- [README.md](./README.md) — perf report one-shot, k6 grid pointers.
- Repo root **`GITHUB_PR_DESCRIPTION.txt`** — full PR runbook + **Joshua / Franco / Arkar** review split.
