# Summary

This PR focuses on **local onboarding / Kafka TLS** (so app pods get **`och-kafka-ssl-secret`** before deploy), **operability** for **Kafka broker DNS** failures (`ENOTFOUND kafka-0.kafka…`), and **reference material** for booking-service growth **without** DB migrations. **`webapp` UI matches `origin/main`**—community, booking routes, messaging sidebar, and related demo UI were **removed from this branch** to narrow scope (those experiments live on the saved branch below).

## Infra / onboarding / Kafka

- **`make dev-onboard`**: Phase **0.25** **`make deps`**, **0.5** **`dev-onboard-zero-trust-preflight`**, **1** **`make up-fast`**, **3.5** sync + **verify** **`och-kafka-ssl-secret`** (`ca-cert.pem`, `client.crt`, `client.key`) with **remediation** (`kafka-ssl-from-dev-root.sh` + Kafka STS restart when needed).
- **`make rollout-och-full`** + **`scripts/rollout-restart-och-full-stack.sh`**: **`ensure-housing-cluster-secrets`** then ordered housing Deployments + **caddy-h3**.
- **`make kafka-diagnose-broker-dns`**: diagnose **`ENOTFOUND kafka-0.kafka.<namespace>.svc.cluster.local`**—headless **`Service/kafka`**, **`StatefulSet/kafka`**, **Ready** **`kafka-0..2`**, **`validate-kafka-dns.sh`**, **`app-config`** snippet.
- **README** quick start notes the **dev-onboard** TLS chain.

## Webapp (aligned with `main`)

- No **`/community`**, **`/booking`**, **MessagingSidebar**, **ClientChrome**, or **ListingBookingModal** on this branch.
- **Optional screenshots** (`E2E_SCREENSHOTS=1`, project **05-optional-screenshots**): **01–07** only (home, login, register, listings, mission, trust, analytics)—same as **`main`**.

## Reference doc (no product code)

- **`BOOKING_SERVICE_EXPANSION_NO_DB.md`** — ideas to extend **booking-service** via API composition, Redis overlays, events, and observability **without** schema changes.

## Teammate handoff — fuller webapp + analytics metrics UI

Earlier iteration (community, messaging UI, booking page, analytics metrics cards, extended screenshots) is preserved on **`saved/feat-webapp-analytics-ui-full`** (`origin`).

```bash
git fetch origin
git checkout -b feat/analytics-ui origin/saved/feat-webapp-analytics-ui-full
# or restore single files, e.g.:
git checkout saved/feat-webapp-analytics-ui-full -- webapp/app/analytics/page.tsx
```

**This PR** keeps **`webapp/app/analytics/page.tsx`** at the **pre–metrics-cards** shell (reverted earlier in branch history).

# Why

- Teammates were blocked on **missing Kafka client PEM secrets** and on **broker DNS** when **`analytics-service`** (and others) could not resolve **`kafka-0.kafka.<namespace>.svc.cluster.local`**.
- Canonical **`make dev-onboard`** should create and **verify** **`och-kafka-ssl-secret`** before app rollouts.
- Narrow **webapp** diff vs **`main`** avoids shipping large UI experiments in the same PR as infra fixes.
- **Booking** expansion notes support planning without committing to DDL.

# Test plan

## Webapp / Playwright (strict edge)

```bash
E2E_RELAX_ANALYTICS_METRICS=1 ./scripts/webapp-playwright-strict-edge.sh

E2E_SCREENSHOTS=1 ./scripts/webapp-playwright-strict-edge.sh --project=05-optional-screenshots
```

- After screenshots: **`webapp/e2e/screenshots/`** should include **01–07** (PNGs are **gitignored**).

## Onboarding (manual / local)

```bash
make images
make dev-onboard   # optional: RESTORE_BACKUP_DIR=latest make dev-onboard
```

- Completes without **Phase 3.5** **`och-kafka-ssl-secret`** verification failures.
- **`kubectl get secret och-kafka-ssl-secret -n off-campus-housing-tracker -o json | jq '.data | keys'`** includes **`ca-cert.pem`**, **`client.crt`**, **`client.key`**.

## Kafka DNS (when analytics logs `ENOTFOUND kafka-0.kafka…`)

```bash
make kafka-diagnose-broker-dns
# then as needed:
make verify-kafka-dns
make kafka-onboarding-reset && make apply-kafka-kraft
make kafka-tls-guard
```
