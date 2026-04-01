# Monitoring snippets (Prometheus rules)

- [`prometheus/rules/restart-anomaly.yaml`](prometheus/rules/restart-anomaly.yaml) — **active** rule templates for `kube_pod_container_status_restarts_total` (requires kube-state-metrics).
- [`prometheus/rules/kafka-election.yaml`](prometheus/rules/kafka-election.yaml) — placeholder; add metrics first.
- [`prometheus/rules/tls-cert-expiry.yaml`](prometheus/rules/tls-cert-expiry.yaml) — placeholder; add exporter first.

Grafana dashboard stubs: [`grafana/dashboards/`](grafana/dashboards/).

See [`docs/CLUSTER_FORENSICS_AND_OBSERVABILITY.md`](../../docs/CLUSTER_FORENSICS_AND_OBSERVABILITY.md) for forensic scripts and preflight hooks.
