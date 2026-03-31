# Kafka TLS: cert-manager (optional) vs dev-root JKS (Colima default)

## Problem this solves

Apps bootstrap to headless DNS names (`kafka-0.kafka.<ns>.svc.cluster.local:9093`). The broker **leaf certificate** must include those names in **Subject Alternative Name** (SAN). Missing SANs → TLS verification fails → CrashLoopBackOff on every Kafka client.

## Default (no cert-manager)

Use **`scripts/kafka-ssl-from-dev-root.sh`** after `certs/dev-root.pem` + `certs/dev-root.key` exist. It builds one shared broker keystore (all brokers use the same cert) with SANs for:

- `kafka`, `localhost`, `kafka-external.<ns>.svc.cluster.local`
- For each replica `i`: `kafka-i`, `kafka-i.kafka`, `kafka-i.kafka.<ns>.svc`, `kafka-i.kafka.<ns>.svc.cluster.local`, `kafka-i-external.<ns>.svc.cluster.local`
- Optional **MetalLB IPs**: `KAFKA_SSL_EXTRA_IP_SANS=192.168.64.241,192.168.64.242,192.168.64.243`

The script stores **`kafka-broker.pem`** in `kafka-ssl-secret` so SAN checks work without a local `certs/` tree.

**Replica count:** `KAFKA_BROKER_REPLICAS=5` if you scale the StatefulSet beyond 3.

## Verify SANs (gate before / after rollout)

```bash
pnpm verify:kafka-tls-sans
# or
HOUSING_NS=off-campus-housing-tracker bash scripts/verify-kafka-tls-sans.sh
```

## cert-manager path (rotation-friendly)

1. Install [cert-manager](https://cert-manager.io/docs/installation/) on the cluster.
2. `kubectl apply -k infra/k8s/kafka-certs/` — creates `ClusterIssuer` `kafka-broker-ca` and `Certificate` objects → Secrets `kafka-0-tls`, `kafka-1-tls`, `kafka-2-tls`.
3. Regenerate CRDs when replica count changes:

   ```bash
   REPLICAS=5 ./scripts/gen-kafka-cert-crds.sh
   ```

   Then extend `kustomization.yaml` with the new `certificates/kafka-N-cert.yaml` entries.

4. **Wire brokers:** Confluent `cp-kafka` expects JKS today. Options:
   - Init container: PEM → PKCS12 → JKS per pod from `kafka-$(ordinal)-tls`, or
   - Move to Kafka PEM keystores when you adopt a image/config that supports them.

Until per-pod JKS wiring lands, **keep the dev-root script** for Colima/k3s dev.

## In-cluster TLS preflight Job

After Kafka and `och-kafka-ssl-secret` exist:

```bash
kubectl apply -f infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml
kubectl -n off-campus-housing-tracker wait --for=condition=complete job/kafka-tls-preflight --timeout=120s
kubectl -n off-campus-housing-tracker logs job/kafka-tls-preflight
```

Delete the job before re-running: `kubectl -n off-campus-housing-tracker delete job kafka-tls-preflight`.

## Related

- KRaft StatefulSet: `infra/k8s/kafka-kraft-metallb/`
- App bootstrap seeds: `pnpm verify:kafka-bootstrap`
