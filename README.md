# Off-Campus-Housing-Tracker

**TL;DR:** Kubernetes-based off-campus housing platform. From repo root, bring the **full local lab** up with **`make cold-bootstrap`** and the current **all-8** Postgres snapshot:

```bash
COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/all-8-20260517-152701 make cold-bootstrap
```

With **`RESTORE_BACKUP_DIR` unset**, **`make cold-bootstrap`** uses **`COLD_BOOTSTRAP_DEFAULT_RESTORE`** (**`backups/all-8-20260517-152701`** when present), else newest **`backups/all-8-*`** / **`all-7-*`**, else empty DBs.

**Prerequisites:** Node 20+, pnpm, Docker/Colima, kubectl — and **curl ≥ 8.19.0 with HTTP/3** on your PATH (macOS system curl is not enough). Install with `brew install curl`, then put Homebrew first, for example `export PATH="/opt/homebrew/opt/curl/bin:$PATH"`. Verify with `./scripts/verify-curl-http3.sh` (enforced by **`make deps`** and bootstrap **P1** via **`scripts/check-curl-preflight-reqs.sh`**).

**Colima after deploy:** If app pods (`listings-service`, `booking-service`, …) sit in **CrashLoopBackOff** while Postgres is up in Compose, pods usually cannot resolve **`host.docker.internal`** to the VM gateway. From repo root with the **colima** kubectl context: **`./scripts/colima-apply-host-aliases.sh`**, then confirm with **`./scripts/diagnose-502-and-analytics.sh`**. See **[Runbook.md](Runbook.md)** and **`docs/DEV_ONBOARDING_FAILURE_MODES.md`**.

Pin a different snapshot: **`RESTORE_BACKUP_DIR=backups/all-8-<stamp> make cold-bootstrap`**. Example: `RESTORE_BACKUP_DIR=$(ls -dt backups/all-8-* 2>/dev/null | head -1)`. Change the default pin for everyone: **`COLD_BOOTSTRAP_DEFAULT_RESTORE=backups/all-8-<stamp> make cold-bootstrap`**. Skip restore: **`RESTORE_BACKUP_DIR=off`**. **`make infra-host`** / **`make infra-cluster`** do not default restore — pass **`RESTORE_BACKUP_DIR=latest`** or a **`backups/all-8-*`** path. First time / after Dockerfile edits, run **`make images`** if you want images built before cold-bootstrap (cold-bootstrap also builds missing **`:dev`** images when needed). For a **lighter** loop when Colima and the cluster are already healthy, use **`make dev`** — see **[BUILD.md](BUILD.md)**. Deeper setup and failures: **`docs/`**, **[Runbook.md](Runbook.md)**.

### Overview

The Off-Campus Housing Tracker is a web-based platform for the **Five College** community to find, compare, and secure off-campus housing. It replaces fragmented sources (social groups, word-of-mouth, stale listings) with **one place** for listings, booking, messaging, and trust signals—so search is faster and misinformation/scams are easier to reason about.

### Features

- Search and filter housing listings (price, amenities, availability)
- Booking and messaging between students and landlords
- Trust system with reviews and reputation scores
- Media uploads for listings
- Analytics and event-driven processing via **Kafka**

---

## Full local stack (canonical)

This is the **supported “whole thing up”** path: **non-interactive** cold bootstrap + restore of **all eight** service Postgres databases (Compose, Colima/k3s, Kafka, TLS, app deploy, observability stack, contract checks).

From **repo root** (recommended — pins the snapshot used for local demos and integration):

```bash
COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/all-8-20260517-152701 make cold-bootstrap
```

**Makefile default** when **`RESTORE_BACKUP_DIR` is unset** (same pin if the directory exists):

```bash
COLD_BOOTSTRAP_CONFIRM=yes make cold-bootstrap
```

Explicit latest (newest `backups/all-8-*` / `all-7-*` when the default pin directory is absent):

```bash
COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=latest make cold-bootstrap
```

---

## Contributing

See **CONTRIBUTING.md** (branching, tests, PR checklist).
