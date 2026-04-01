# CI check runs (tally)

One **pull_request** sync on a feature branch should produce **one** run per workflow (no duplicate `och-ci` from the same branch `push`).

## Expected jobs per PR (approx.)

| Workflow | Job rows | What they are |
|----------|----------|----------------|
| **och-ci** | **27** | rollup-wasm-guard, protocol-anomaly, **Build ×10**, **Test ×10**, transport-validation, slo-policy, quic-hostname-invariant, Strict Playwright, aggregate gate |
| **och-docker-build** | **12** | build-images matrix (api-gateway, transport-watchdog, 8 services, cron-jobs, webapp) |
| **Protocol validation** | **5** | shellcheck-preflight, transport-quic-pipeline, endpoint-coverage-static, readiness-with-transport-fixture, playwright-strict-verticals |
| **Kafka cluster verify** | **1** | verify (ShellCheck + bash -n + **replicas:3** on `statefulset.yaml`) |
| **kafka-dns-validate** | **1** | shell-and-kustomize (`kubectl kustomize` + **replicas:3** on rendered bundle) |
| **Protocol readiness gate** | **1** | validate-transport-fixture |
| **Total** | **~47** | Single PR event; see skips below |

## Playwright (no longer “Skipped” on default)

- **`och-ci` / Strict Playwright** and **protocol-validation / playwright-strict-verticals** **always run**.
- Default: **`pnpm exec playwright test --list`** after installing Chromium (proves config + deps resolve on `ubuntu-latest`).
- Set repository variable **`RUN_STRICT_PLAYWRIGHT`** = **`true`** to run the full **`test:e2e:strict-verticals-and-integrity`** suite (needs reachable **`E2E_API_BASE`**, dev CA, etc.).

**Aggregate gate** still accepts **`skipped`** for Playwright only if the job is skipped for another reason; with the default path the job should end **`success`**.

## Kafka: three brokers vs CI unit tests

- **In-cluster default:** **`infra/k8s/kafka-kraft-metallb/`** is a **3-replica** KRaft StatefulSet (quorum / `kafka-0`–`2`). CI **static** jobs assert **`replicas: 3`** in the manifest and in the **kustomize** render (`kafka-dns-validate`, **`Kafka cluster verify`**).
- **`och-ci` / Test matrix:** Uses **one** ephemeral **Docker** Confluent broker + TLS (**`scripts/ci/start-kafka-tls-ci.sh`**) so Vitest can talk to Kafka on **`127.0.0.1:29094`** without a Kubernetes cluster. That is **not** a three-broker cluster; it exercises **client TLS**, **topic isolation** (`OCH_KAFKA_TOPIC_SUFFIX`), and service logic. Full **`make verify-kafka-cluster`** / broker API checks still require a real cluster (local Colima/k3d).

## Why you used to see ~72 rows

- **`och-ci`** was configured with **`push` + `pull_request`** on every branch, so one push to a PR branch started **two** full `och-ci` runs (~54 rows) that shared **`concurrency: cancel-in-progress`** → the second run **cancelled** the first → many **Cancelled** tests and a red **aggregate gate**.
- Fix: **`push`** for `och-ci` is limited to **`main` / `master` / `develop`**; PR work uses **`pull_request` only**. Concurrency group uses **PR number** when present so runs are scoped correctly.

**Concurrency:** `och-ci` groups runs by **`github.head_ref || github.ref_name`** so **`pull_request`** and **`push`** for the same branch share one queue and **`cancel-in-progress`** does not leave duplicate matrix rows fighting each other. **`push`** to feature branches is disabled (`push` only **`main`/`master`/`develop`**).

**ShellCheck in CI:** **`shellcheck -S error`** on protocol + Kafka verify jobs so **info/style** findings do not fail the build (real **error** severities still fail).

**Git:** `git rebase --abort` only undoes an *in-progress* rebase locally; it cannot “undo” a push already on GitHub. To match remote after a mess: `git fetch origin fix/ci && git reset --hard origin/fix/ci`.

**“Queued” checks:** GitHub-hosted runners are shared. This repo caps **matrix** fan-out (`max-parallel` on `och-ci` build/test and `och-docker-build`) so one PR does not request dozens of jobs at once and sit behind the org/repo concurrency limit. Duplicate workflow runs on the same branch are also collapsed via **`concurrency`** + **`cancel-in-progress`** on auxiliary workflows. Short queue time is normal during GitHub incidents or peak usage.

## Path filters

- **Protocol / Kafka / readiness** workflows: **`pull_request`** runs on **all PRs** (stable surface). **`push`** to default branches may stay path-filtered where noted in each workflow to save minutes on `main`.
