# Off-Campus-Housing-Tracker

**TL;DR:** Kubernetes-based off-campus housing platform. From repo root, bring the **full local lab** up with a **pinned eight-Postgres restore** using:

```bash
COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/all-8-20260505-133943 make cold-bootstrap
```

Swap **`20260505-133943`** for your bundle under **`backups/all-8-*`**. First time / after Dockerfile edits, run **`make images`** if you want images built before cold-bootstrap (cold-bootstrap also builds missing **`:dev`** images when needed). For a **lighter** loop when Colima and the cluster are already healthy, use **`make dev`** — see **[BUILD.md](BUILD.md)**. Deeper setup and failures: **`docs/`**, **[Runbook.md](Runbook.md)**.

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

This is the **supported “whole thing up”** path: **non-interactive** cold bootstrap + **pinned** restore of **all eight** service Postgres databases from a known **`backups/all-8-*`** tree (Compose, Colima/k3s, Kafka, TLS, deploy, observability, contract checks).

From **repo root**:

```bash
COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/all-8-20260505-133943 make cold-bootstrap
```

---

## Contributing

See **CONTRIBUTING.md** (branching, tests, PR checklist).
