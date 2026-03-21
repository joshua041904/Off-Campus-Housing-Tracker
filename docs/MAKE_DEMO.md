# Makefile: demo, network capture, preflight

The repo root **`Makefile`** wraps the same bash scripts used in CI and docs. Run `make help` for a short list.

## Prerequisites

- **kubectl** context pointing at **Colima + k3s** for `make demo` / `make demo-network` / `make demo-full` (these set **`REQUIRE_COLIMA=1`** and **`METALLB_USE_K3D=0`**). Use **`make demo-k3d`** only if you intentionally use k3d.
- **Docker** / **Colima** for image builds (`make images`).
- **kustomize**, **pnpm**, **bash**.

## Primary targets

| Target | What it does |
|--------|----------------|
| **`make demo`** | **Colima + k3s** (`REQUIRE_COLIMA=1`, no k3d). Stack + preflight with **`METALLB_ENABLED=1`**, **`K6_USE_METALLB=1`**, **`RUN_PGBENCH=0`**, **`RUN_FULL_LOAD=0`**, **`PREFLIGHT_EXIT_AFTER_HOUSING_SUITES=1`**: stops after step **7a** (housing **`test-microservices-http2-http3-housing.sh`**, k6 edge grid, **Playwright** via **`run-playwright-e2e-preflight.sh`**). Does **not** run transport study / extended pgbench unless you unset that flag. |
| **`make demo-full`** | Same Colima path but **`PREFLIGHT_EXIT_AFTER_HOUSING_SUITES=0`** and **`RUN_FULL_LOAD=1`** — continues preflight after 7a (transport study, in-cluster k6 when enabled, pgbench when **`RUN_PGBENCH=1`**). |
| **`make demo-network`** | Runs **`scripts/run-demo-network-preflight.sh`**: sets **`SSLKEYLOGFILE`** + **`CAPTURE_V2_TLS_KEYLOG`**, **`STRICT_QUIC_VALIDATION=1`**, MetalLB + k6 LB defaults, runs **`run-preflight-scale-and-all-suites.sh`**, then (by default) **`test-packet-capture-standalone.sh`** when **`TARGET_IP`** is available. See **`scripts/lib/COHERENT_ANALYSIS.md`** for pcap → summary pipelines. |
| **`make stack`** | Full setup **without** preflight (faster iteration after the first demo). |
| **`make demo-k3d`** | Like **`make demo`** but **`SKIP_COLIMA=1`**, **`METALLB_USE_K3D=1`**, **`REQUIRE_COLIMA=0`** — use when your context is **k3d**, not Colima. |
| **`make images`** | **`scripts/build-housing-images-k3s.sh`** only. |
| **`make kustomize-apply`** | Apply **`infra/k8s/overlays/dev`**. |
| **`make deploy-dev`** | **`scripts/deploy-dev.sh`** (smoke + rollout waits). |
| **`make test-e2e-integrated`** | **`pnpm run test:e2e:integrated`** (port-forward gateway + Playwright). |
| **`make packet-capture-standalone`** | **`scripts/test-packet-capture-standalone.sh`** alone. |
| **`make preflight-metallb`** | Preflight script only; set **`RUN_PGBENCH`**, **`RUN_FULL_LOAD`**, etc. on the command line. |

## Environment tips

- **`HOUSING_NS`**: defaults to `off-campus-housing-tracker` in scripts; export to override.
- **Skip Colima** when the cluster already exists:  
  `SKIP_COLIMA=1 make demo` (still runs the rest of setup + preflight).
- **Skip standalone packet test** after preflight:  
  `RUN_STANDALONE_PACKET_TEST=0 make demo-network`.
- **Cron worker (housing-only)**: set **`NOTIFICATION_HEARTBEAT_URL`** to the notification internal heartbeat URL; no legacy auction jobs are scheduled by default.

## Analytical pipeline (lib)

After captures, optional tools under **`scripts/lib/`** include:

- **`generate-transport-summary-from-pcap.sh`**
- **`compare-transport.py`**, **`transport-diff.py`**, **`analyze_tls_timing.py`**
- **`COHERENT_ANALYSIS.md`** — how pieces fit together

## Git / CI

These targets do **not** push git; run **`git add` / `git commit` / `git push`** yourself after verifying on your machine.
