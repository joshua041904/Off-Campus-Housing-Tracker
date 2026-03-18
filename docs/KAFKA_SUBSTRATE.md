# Kafka substrate: strict TLS, mTLS, exactly-once

This document summarizes how Kafka is set up in the substrate bundle so you get **strict TLS**, **mTLS**, and **exactly-once semantics** out of the box.

---

## Strict TLS

- **Broker:** Listens on **SSL only** for clients (port 9093). PLAINTEXT is bound to `127.0.0.1:9092` only (healthcheck); no client access.
- **Docker Compose** (`docker-compose.yml`): Kafka service uses `KAFKA_LISTENERS: PLAINTEXT://127.0.0.1:9092,SSL://0.0.0.0:9093`, host port **29093:9093**.
- **In-cluster** (optional): `infra/k8s/base/kafka/` has deploy + service with same SSL config and **KAFKA_SSL_CLIENT_AUTH: required**.

---

## mTLS (client auth required)

- **Broker:** `KAFKA_SSL_CLIENT_AUTH: required` (Docker Compose and in-cluster). Every client must present a valid client certificate signed by the same CA as the broker.
- **Certificates:** Run **`scripts/kafka-ssl-from-dev-root.sh`** after CA reissue. Uses `certs/dev-root.pem` and `certs/dev-root.key`. Produces:
  - `certs/kafka-ssl/` — broker keystore/truststore (JKS), CA PEM, client keystore (P12) for apps.
  - **kafka-ssl-secret** in the app namespace (e.g. `off-campus-housing-tracker`) with `ca-cert.pem`, keystore, truststore.
- **Apps:** Set `KAFKA_SSL_ENABLED=true`, `KAFKA_CA_CERT` to path of CA PEM (e.g. `/etc/kafka/secrets/ca-cert.pem`). Mount **kafka-ssl-secret** in every service that talks to Kafka. For mTLS client auth, set `KAFKA_CLIENT_CERT` / `KAFKA_CLIENT_KEY` (or equivalent) from the same secret if your client library supports it.
- **ConfigMap** (`infra/k8s/base/config/app-config.yaml`): `KAFKA_BROKER` uses port **9093**, `KAFKA_USE_SSL` and `KAFKA_SSL_ENABLED` are **true**.

---

## External Kafka (Docker Compose) from K8s

- **kafka-external:** `infra/k8s/base/kafka-external/external-service.yaml` defines a Service + Endpoints that point at the **host** (Docker Compose Kafka on 29093). Pods use `KAFKA_BROKER=kafka-external.<namespace>.svc.cluster.local:9093`.
- **After apply:** Update the Endpoints IP to your host (e.g. Colima gateway `192.168.5.2` or `host.docker.internal` resolution). Scripts may provide `patch-kafka-external-host.sh` or equivalent; otherwise edit the Endpoints resource and set `subsets[].addresses[].ip` to the host IP reachable from the cluster.

---

## Exactly-once semantics

- **Idempotent producer:** In app code (e.g. KafkaJS), set **`idempotent: true`** (or `enable.idempotence: true`) so retries do not duplicate messages.
- **Consumer isolation:** For transactional reads, use **`isolationLevel: IsolationLevel.ReadCommitted`** (or `read_committed`) so the consumer only sees committed messages.
- **Broker (multi-broker):** When you run multiple brokers, set **`transaction.state.log.replication.factor`** and **`transaction.state.log.min.isr`** for the transaction coordinator. Single-broker: replication factor 1 is fine.
- **Docs:** See **docs/KAFKA_CURRENT_AND_ROADMAP.md** (§5 Exactly-once semantics) and **docs/STRICT_TLS_MTLS_AND_KAFKA.md** for the full checklist.

---

## Bundle contents

| Item | Purpose |
|------|---------|
| `docker-compose.yml` | Kafka + Zookeeper, SSL 9093, mTLS required |
| `infra/k8s/base/kafka-external/` | Service + Endpoints to external broker |
| `infra/k8s/base/kafka/` | In-cluster Kafka (optional), strict TLS + mTLS |
| `infra/k8s/base/config/app-config.yaml` | KAFKA_BROKER :9093, KAFKA_SSL_ENABLED true |
| `scripts/kafka-ssl-from-dev-root.sh` | Build broker + client certs from dev-root CA |
| `certs/kafka-ssl/` | Created by script; mount in broker and apps |

Replace `off-campus-housing-tracker` namespace with your app namespace in all manifests and scripts.
