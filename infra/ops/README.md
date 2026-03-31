# Kafka KRaft ops add-ons

- **`kafka-dns-auto-remediation.yaml`** — CronJob every 5m: if EndpointSlice hostnames point at wrong pod IPs, delete slices so they are recreated. Uses `docker.io/alpine/k8s:1.30.8` (bash + `kubectl`; Bitnami `kubectl` tags are unreliable on Docker Hub).
- **`kafka-quorum-check.yaml`** — CronJob every 2m: `kafka-metadata-quorum describe --status` over SSL to bootstrap (needs `kafka-ssl-secret`).

Apply:

```bash
kubectl apply -k infra/ops/
```

CronJob `spec` includes `successfulJobsHistoryLimit: 1`, `failedJobsHistoryLimit: 1`, and each Job has `ttlSecondsAfterFinished: 300`. If an older apply omitted those fields, refresh:

```bash
kubectl apply -k infra/ops/
```

Prune succeeded Jobs (optional):

```bash
kubectl delete job -n off-campus-housing-tracker --field-selector status.successful=1
```

Delete **finished Jobs** (and their pods) for these CronJobs immediately (uses `batch.kubernetes.io/cronjob-name`):

```bash
./scripts/cleanup-kafka-ops-cronjob-pods.sh
```

Manual checks:

```bash
./scripts/validate-kafka-dns.sh
kubectl create job --from=cronjob/kafka-quorum-check kafka-quorum-check-manual -n off-campus-housing-tracker
kubectl logs job/kafka-quorum-check-manual -n off-campus-housing-tracker
```

Before rolling out Kafka producers:

```bash
KAFKA_K8S_SKIP_API_HEALTH=1 ./scripts/preflight-kafka-k8s-rollout.sh
```

## Colima / `ImagePullBackOff` on `auth-service:dev` or `trust-service:dev`

Base Deployments use **`image: <name>:dev`** and **`imagePullPolicy: IfNotPresent`**. BackOff usually means the image is not in the **Colima** Docker that k3s uses (wrong `docker context`, or image built only on the host).

1. `docker context use colima` (build and load via repo scripts target Colima).
2. Rebuild and load, then restart:

   ```bash
   SERVICES="auth-service trust-service" ./scripts/rebuild-och-images-and-rollout.sh
   ```

3. If replicas were scaled to zero, scale back: `kubectl scale deploy/auth-service deploy/trust-service --replicas=1 -n off-campus-housing-tracker`
