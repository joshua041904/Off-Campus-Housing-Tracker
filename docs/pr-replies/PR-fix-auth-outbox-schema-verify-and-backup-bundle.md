# PR reply: auth outbox, CI, Kafka, Vitest stack

Use this as the PR description or reviewer summary.

## Summary

This branch aligns **auth** transactional outbox and restore tooling with **dual outbox** tables, tightens **och-ci** behavior (transport-validation after integration, push vs PR concurrency), keeps **Kafka TLS / zero-trust** operational hooks documented, and adds a **repo Vitest stack** (per-service integration with a Kafka policy gate, system contracts, then units) wired into **preflight by default**.

## What reviewers should know

- **Auth:** Schema and scripts expect both outbox surfaces; old restores may need `infra/db/01-auth-outbox.sql` on the auth DB if `outbox_events` is missing.
- **CI:** Plaintext Kafka in GHA remains for selected unit/integration batches, not a substitute for the **3-broker TLS** path used locally for listings/booking/system.
- **Preflight:** Step **7a0c** runs `pnpm -C services/common run build` and `pnpm run test:vitest-stack` unless `PREFLIGHT_RUN_REPO_VITEST_STACK=0`. That needs full local integration infra (Postgres services, MetalLB Kafka externals, TLS material, analytics DB for system tests).

## Quick checks

- [ ] CI: integration-tests and downstream jobs green.
- [ ] Optional local: `make test-vitest-stack` or preflight with stack left on when the cluster and DBs are up.

Made with Tom.
