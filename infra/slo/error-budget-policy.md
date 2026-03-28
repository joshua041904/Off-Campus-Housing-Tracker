# OCH error budget policy

## Availability SLO (rolling 30 days)

- **Target:** 99.5% successful responses (2xx) / all responses, per `service` label on `http_requests_total`.
- **Error budget:** 0.5% of requests may be non-success over the window (non-2xx, excluding planned maintenance when metrics carry `maintenance="true"`).

### Calendar intuition (downtime minutes, not request-based)

30 days ≈ 43,200 minutes. Treating “0.5% of time down” as a rough mental model: **~216 minutes / month** of equivalent bad time only if errors correlate with full outages. **Authoritative** measurement is request-based availability from Prometheus (see recording rules).

## Burn detection (aligned with `infra/k8s/base/observability/prometheus-rules-och-slo.yaml`)

| Severity | Alert / signal | Meaning |
|----------|----------------|--------|
| **Critical** | `OCHCriticalBurnRate` | Multi-window fast **and** sustained burn — page / deploy freeze candidate |
| **Warning** | `OCHWarningBurnRate` | Slower sustained burn — investigate before budget is gone |
| **Critical** | `OCHSLOViolation` | **Already broken:** 30-day rolling availability **&lt; 99.5%** (not only “trending bad”) |
| **Warning** | `OCHBudgetExhaustionImminent` | Heuristic: **&lt; 72h** to budget exhaustion at current 1h error rate (see recording rule caveats) |

| Window | Role |
|--------|------|
| **Critical (multi-window burn)** | 5m **and** 1h must both exceed burn thresholds |
| **Warning burn** | 1h sustained |

Multipliers (99.5% SLO, budget = 0.005):

- Critical short window: error rate **> 0.005 × 14.4**
- Critical long window: error rate **> 0.005 × 6**
- Warning: error rate **> 0.005 × 3** for 30m

## When remaining budget is low

If rolling availability shows **&lt; 20% of monthly error budget remaining** (operational judgment, not auto-computed here):

- Freeze non-critical deploys.
- Require SRE / owner approval for production changes.

## Deploy freeze override

Automated **deploy freeze** (e.g. CI job `scripts/slo/check-burn-rate.js` when `PROM_URL` is set, or org policy tied to `OCHCriticalBurnRate`) may block merges or deployments.

**Override (intentional, audited):**

1. Add GitHub PR label **`override-freeze`** on the change that must land during freeze.
2. Obtain **explicit approval from one on-call engineer** (or designated SRE / platform owner for your team) recorded in the PR (comment or review).
3. Remove the label after merge or if the override is cancelled.

This prevents silent bypass while allowing controlled emergency changes.

### Who approves override

Default: **current on-call engineer** for the service / platform (as defined in your paging rotation). If you have no rotation, use **one named owner** from `CODEOWNERS` or the team runbook — document that name in your internal ops wiki and keep this file’s process generic.

## Planned maintenance

1. **Preferred:** stop routing user traffic (ingress maintenance page) so bad requests are not attributed to SLO.
2. **Optional metric filter:** emit `maintenance="true"` on request metrics during maintenance, or drop scrapes; PromQL uses `maintenance!="true"` so series **without** the label still count (normal traffic).

**Kubernetes deployment labels do not appear on `http_requests_total`.** Maintenance exclusion must be implemented in the app or proxy that increments the counter.

## Recording rule names (quick reference)

- **`och:service_error_budget_remaining_ratio`** — absolute headroom: `0.005 − (1h error rate)` in the same units as the monthly budget (0.005 = 100% of that budget). **Can be negative** when you are over budget; the name is historical, not a 0–1 ratio.
- **`och:service_budget_remaining_ratio_1h`** — normalized **non-negative** fraction of budget left in `[0, 1]`, derived from the same 1h error rate.

## Prometheus retention

30-day recording rules require TSDB retention **≥ 30 days**. The default Prometheus deployment sets `--storage.tsdb.retention.time=45d` (see `prometheus-deploy.yaml`).

## CI vs runtime

- **CI:** `scripts/slo/check-error-budget.js` reads checked-in `bench_logs/uptime-summary.json` (synthetic / exported summary). Update that file from your uptime pipeline when you want the gate to reflect production.
- **Runtime:** Grafana + Alertmanager + rules in this repo.

## Optional hardening (not implemented here)

- Symmetric transport check: HTTP/1 p95 &gt; 5× HTTP/2 p95 → warn (see Grafana panel).
- Absolute p95 SLO caps per service.
- Multi-burn-rate windows (additional pairs) per Google SRE workbook.
