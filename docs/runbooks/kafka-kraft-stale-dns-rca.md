# RCA & runbook: Kafka KRaft quorum instability (stale headless DNS / EndpointSlices)

## Incident title

Kafka KRaft quorum instability due to stale EndpointSlice-backed DNS for the headless Service `kafka`.

## Impact

- Controllers could not maintain Raft connections on `:9095` (CONTROLLER listener).
- Repeated elections, `leader is (none)`, `highWatermark=Optional.empty`.
- `CrashLoopBackOff` or non-Ready brokers; cluster failed to stabilize.

## Root cause

The headless Service `kafka` is backed by **EndpointSlices**. After **pod IP churn** (reschedule, recreate, scale events), **EndpointSlice addresses sometimes lagged** behind live `Pod.status.podIP`.

DNS names:

`kafka-N.kafka.off-campus-housing-tracker.svc.cluster.local`

resolved (via those slices) to **old pod IPs**. Brokers then attempted Raft to **dead addresses** on port **9095** → TCP timeouts → `Connection to node X ... :9095 could not be established`.

**TLS was not the root cause** in the resolved incident; transport never reached a stable handshake when the peer IP was wrong.

## Contributing factors

- **k3s / Colima** (and similar) environments: occasional **EndpointSlice controller lag** or inconsistency after churn.
- **Parallel** `podManagementPolicy` + `publishNotReadyAddresses`: correct for KRaft bootstrapping, but increases sensitivity to **any** DNS/slice skew during turbulence.

## Detection signals

1. Logs (any broker):

   `Connection to node N (kafka-N.kafka...:9095) could not be established`

2. **Slice vs pod mismatch**:

   ```bash
   kubectl get pod kafka-1 -n off-campus-housing-tracker -o wide
   kubectl run -n off-campus-housing-tracker --rm -it --restart=Never --image=busybox:1.36 -- \
     nslookup kafka-1.kafka.off-campus-housing-tracker.svc.cluster.local
   ```

   If **DNS A record ≠ live pod IP** → treat as stale EndpointSlice/DNS.

3. Automated:

   ```bash
   ./scripts/validate-kafka-dns.sh
   ```

## Immediate remediation

```bash
kubectl delete endpointslice -n off-campus-housing-tracker -l kubernetes.io/service-name=kafka
kubectl rollout restart statefulset/kafka -n off-campus-housing-tracker
```

Re-run `./scripts/validate-kafka-dns.sh` until all rows **OK**.

## Runbook: Kafka Raft fails to stabilize

1. **Quorum pods**

   `kubectl get pods -n off-campus-housing-tracker -l app=kafka`

2. **Log pattern**

   `kubectl logs kafka-0 -n off-campus-housing-tracker | grep -E 'could not be established|Leader|Candidate'`

3. **DNS vs pod IP** (see above) + `./scripts/validate-kafka-dns.sh`

4. **Fix EndpointSlices** (delete by label; they are recreated)

5. **Controlled restart** of the StatefulSet after slice repair

## Configuration lock-down (current manifest)

- `KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=INTERNAL:SSL,EXTERNAL:SSL,CONTROLLER:SSL`
- `KAFKA_SSL_CLIENT_AUTH=required`
- `KAFKA_LISTENER_NAME_INTERNAL_SSL_CLIENT_AUTH=required`
- `KAFKA_LISTENER_NAME_EXTERNAL_SSL_CLIENT_AUTH=required`
- `KAFKA_LISTENER_NAME_CONTROLLER_SSL_CLIENT_AUTH=none` (controller quorum channel; props enforced in startup script)

Do **not** scale the StatefulSet below **3** while `controller.quorum.voters` lists three nodes.

## Preventative controls in-repo

| Control | Location |
|--------|-----------|
| PodDisruptionBudget `minAvailable: 2` | `infra/k8s/kafka-kraft-metallb/kafka-pdb.yaml` |
| DNS/slice validation script | `scripts/validate-kafka-dns.sh` |
| Optional auto-remediation CronJob | `infra/ops/kafka-dns-auto-remediation.yaml` |
| Optional quorum describe CronJob (SSL) | `infra/ops/kafka-quorum-check.yaml` |
| Replica ≥ 3 admission guard | `infra/policies/kafka-replica-guard.yaml` (K8s 1.26+ VAP) |
| Prometheus platform alerts | `monitoring/prometheus-rules/kafka-kraft-dns.yaml` |

## Loki log alerts (optional)

If you use Loki + ruler, add a rule equivalent to:

- High rate of log lines matching `Connection to node` and `could not be established` on `pod=~"kafka-.*"` in namespace `off-campus-housing-tracker`.

(PrometheusRule CRD does not evaluate LogQL; keep that in Loki.)

## JMX / Kafka metrics (optional)

With JMX Exporter on brokers, consider alerts on:

- Active controller count ≠ 1
- High raft leader change rate
- Under-replicated partitions > 0

Exact metric names depend on your JMX scrape config; add to Prometheus after exporters are wired.

## Pre-flight before deploying application services

- [ ] Three brokers `Running`, Ready stable (e.g. 10+ minutes), low restarts
- [ ] `./scripts/validate-kafka-dns.sh` passes
- [ ] Manual or CronJob: `kafka-metadata-quorum describe --status` succeeds (SSL client config as in `infra/ops/kafka-quorum-check.yaml`)
- [ ] `KAFKA_K8S_SKIP_API_HEALTH=1 ./scripts/preflight-kafka-k8s-rollout.sh` — broker `min.insync.replicas` / `auto.create.topics.enable`, ensure proto-derived topics with RF=3 and topic `min.insync.replicas=2`

## Key lesson

Distributed systems **fail loudly in logs** when **DNS lies quietly**: stale A records for headless Services produce the same symptoms as many TLS or “election collision” theories—verify **EndpointSlice address == pod IP** early.
