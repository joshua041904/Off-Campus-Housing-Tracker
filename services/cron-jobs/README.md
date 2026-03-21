# Cron Jobs Service

Housing **notification heartbeat** worker only: every **5 minutes** (UTC) it `POST`s to **`NOTIFICATION_HEARTBEAT_URL`** when that env var is set. If unset, the process stays up and logs a no-op message.

## Configuration

| Variable | Required | Example |
|----------|----------|---------|
| **`NOTIFICATION_HEARTBEAT_URL`** | No (no-op if empty) | `http://notification-service.off-campus-housing-tracker.svc.cluster.local:4015/internal/cron/heartbeat` |

## Run locally

```bash
pnpm install
NOTIFICATION_HEARTBEAT_URL=http://127.0.0.1:4015/internal/cron/heartbeat pnpm start
```

## Legacy record-platform jobs

Daily auction snapshot / S3 backup crons were **removed** from this package. Run those from a separate job or an older branch if you still need `listings.auctions` analytics.

## Other docs

- **Makefile / demo**: `docs/MAKE_DEMO.md`
- **Daily pgbench / host cron**: sections below (unchanged host workflows)

---

## Daily pgbench (all 8 DBs, standalone)

To run **all 8 pgbench sweeps** daily (no preflight; deep mode, EXPLAIN for all schemas) and collect results:

1. **Host cron:**  
   ```bash
   ./scripts/install-pgbench-daily-cron.sh          # print crontab line
   ./scripts/install-pgbench-daily-cron.sh --install # append to crontab
   ```
   Default schedule: 05:00 local. Results: `PGBENCH_RESULTS_PARENT/daily-pgbench-<timestamp>/` (default parent: `/tmp`).  
   Prereq: Postgres 5433–5440 up (e.g. docker-compose), migrations applied.

2. **Colima/k3s storage:** If k3s is flaky, run `./scripts/colima-k3s-storage-diagnostic.sh` to check VM disk, etcd size, and node resources. See `docs/COLIMA_K3S_FORENSIC_AND_TUNING.md`.

## Daily test suite (preflight + all suites)

To run the **preflight and full test suite** daily and collect results:

1. **Host cron** (recommended):  
   Run `scripts/run-daily-test-suite-with-results.sh` from the repo root, e.g.:
   ```bash
   0 6 * * * /path/to/off-campus-housing-tracker/scripts/run-daily-test-suite-with-results.sh
   ```
   Results go to `/tmp/daily-suite-<timestamp>/` (or `SUITE_LOG_PARENT/daily-suite-<timestamp>/`). The script prints a short self-analyze (which suite failed, failure snippets).

2. **CI (e.g. GitHub Actions):**  
   Use `.github/workflows/rotation-chaos.yml` or add a workflow that runs `run-preflight-scale-and-all-suites.sh` and uploads `SUITE_LOG_DIR` as artifacts.

3. **Kubernetes CronJob:**  
   To run the suite inside the cluster you need a image that includes the repo scripts and `kubectl`; we do not ship that by default. Prefer host cron or CI.

## Self-analyze

`run-daily-test-suite-with-results.sh` writes:

- `summary.txt`: PASS/FAIL and per-suite result; failure/error lines to narrow scope.
- `failures.txt`: Snippets of FAIL/error lines from suite logs.

Use these to see which suite and which test failed without opening full logs.
