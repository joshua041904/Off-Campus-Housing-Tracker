# CI check runs (tally)

## `och-ci` row count (why ~21 vs ~42)

One **full** `och-ci` workflow run exposes **~21** check rows (rollup, protocol-anomaly, **Build ×10**, integration-tests, transport-validation, slo-policy, quic-hostname-invariant, playwright-strict, aggregate gate).

When you have an **open PR** and **push** to that branch, GitHub runs **`och-ci`** for **`pull_request`** and again for **`push`** → **~42** `och-ci`-related rows (each job appears twice with different event labels). Same pattern as before: not duplicate jobs by mistake, **two workflow runs**.

**Integration tests** use **GHA service containers**: **Zookeeper + Kafka PLAINTEXT** on **127.0.0.1:9092**. **`timeout-minutes: 20`**.

## Total checks (~45 vs ~68)

Rough guide for a feature PR that touches common paths:

| Source | Approx. rows |
|--------|----------------|
| **och-ci** ×2 (push + pull_request) | **~42** |
| **och-docker-build** ×2 | **~24** |
| Protocol / kafka static / readiness (often PR + path-filtered push) | **~10–20** |

**~68** is normal when **push** and **pull_request** both fire on several workflows. **~25** usually means only **one** `och-ci` run is present (e.g. `on.push` for `och-ci` was default branches only — restored to include **fix/**, **feat/**, etc.).

## Aggregate gate (~4s failure)

**och-ci-gate** only evaluates **`needs.*.result`** — a few seconds is expected. It fails if any required job is not **`success`** (Playwright has a **`skipped`** escape hatch in one case).

If **`integration-tests`** is **cancelled** or **failure**, the gate fails with that reason. **`transport-validation`** uses **`if: always()`** so it is not left **skipped** merely because integration was cancelled (downstream signal + clearer diagnostics).

## Concurrency

**`cancel-in-progress: true`** with **`github.event_name`** in the group: a new **push** cancels the previous **push** run on the same ref; a new **pull_request** sync cancels the previous **PR** run. It does **not** cancel the sibling **push** run (and vice versa).

## Playwright

- Default: **`pnpm exec playwright test --list`**.  
- **`RUN_STRICT_PLAYWRIGHT=true`**: full strict E2E (needs **`E2E_API_BASE`**, dev CA, etc.).

## Kafka: three brokers vs `och-ci`

- **K8s manifests:** static jobs assert **3** replicas.  
- **`och-ci`:** one **PLAINTEXT** broker for Vitest — not three-broker KRaft.

## Path filters

Some workflows only run on **`push`** when certain paths change; see each file under **`.github/workflows/`**.
