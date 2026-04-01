# PR: CI hardening, transport watchdog, in-cluster KRaft Kafka (3 brokers)

## Summary

This branch tightens **CI**, adds a small **transport observability** service, and makes **Kafka** the **default in-cluster KRaft (3 brokers)** path instead of leaning on **Docker Compose** for the broker. Preflight, TLS/bootstrap checks, and edge DNS alignment are updated so **local behavior matches what CI and k6/curl actually use**.

## Why we did it

- **Compose Kafka** was a second topology to maintain and easy to drift from what runs in **k3s/Colima** (wrong bootstrap, wrong TLS SANs, flaky preflight).
- **Three brokers** matches real cluster shape, improves **quorum/resilience** story, and forces **comma-separated bootstrap** + correct **advertised listeners** in app code.
- **CI** needed **deterministic gates** (kustomize/build, DNS-shaped checks, protocol/contract alignment) when Kafka or ingress manifests change.
- **Transport watchdog** gives a **lightweight signal** on HTTP/2 (and related) behavior at the edge without bloating every service.
- **Edge preflight** was wrong when it trusted **`dig` first** — **`dig` often skips `/etc/hosts`**, so it disagreed with **`curl`** and Playwright/k6; resolution now follows the **system resolver** family first.

## What shipped (tight list)

| Area | What |
|------|------|
| **Kafka** | **`infra/k8s/kafka-kraft-metallb/`** — 3× KRaft brokers, headless DNS, MetalLB-friendly exposure, PDB. **`infra/k8s/kafka-certs/`** — cert-manager broker certs + TLS preflight pattern. Optional **`kafka-host-compose`** overlay for rare host-broker experiments. |
| **Compose / config** | **No Compose Kafka as default**; comments and **`app-config`** point at **in-cluster** `kafka-0/1/2…:9093`. **`services/common` `kafka.ts`** — multi-seed bootstrap; **`kafka-wait`** and related wiring for readiness. |
| **Scripts / Make / pnpm** | `verify-kafka-cluster`, bootstrap/TLS/SAN/KRaft/advertised-listener checks, k8s topic creation, contract validate, **edge preflight** (`OCH_EDGE_IP`, resolver fix). |
| **CI** | **`kafka-cluster-verify`**, **`kafka-dns-validate`**, updates to **`ci.yml`** / **`protocol-validation.yml`** so manifest and script changes get exercised. |
| **Transport watchdog** | New **`services/transport-watchdog`** — small service to observe/report transport behavior at the edge (supports the HTTP/2 / observability story without duplicating logic everywhere). |
| **E2E / listings (already on branch)** | Playwright stability (workers, serial heavy suites, guards), **listings** tests + integration harness — keeps **main CI green** while the infra story lands. |
| **Docs** | **`docs/DESIGN.md`** for deep architecture; **README** / **ENGINEERING** stay short entrypoints; **Kafka** docs updated for KRaft-first default. |

## How reviewers can sanity-check

- Brokers up → `pnpm verify:kafka-bootstrap` / `pnpm verify:kafka-cluster` (with valid cluster access).
- Edge → `pnpm verify:preflight-edge-routing` and/or `curl` to **`https://off-campus-housing.test/...`** with **`certs/dev-root.pem`** (ping loss on LB IP is normal; **HTTPS** is the truth).

---

_Paste the sections above into the GitHub PR description as needed (title vs body)._
