# Kafka: Current Setup and Roadmap

## Triage (what was reverted / what was not changed)

- **Reverted:** `infra/k8s/base/config/app-config.yaml` — **KAFKA_BROKER** was listing three ports (`:9093,:9094,:9095`). We only run a single broker (Docker Compose SSL on 9093 / host 29093). Reverted to **single broker**: `kafka-external.record-platform.svc.cluster.local:9093`. Individual service deploy overrides (analytics, python-ai, auction-monitor, social, shopping) already used `:9093` only; ConfigMap is now consistent.
- **Not changed (Kafka “setup”):** docker-compose Kafka service, Zookeeper, kafka-external Service/Endpoints, certs, `services/common/src/kafka.ts`, strict-tls-bootstrap.sh. No broker config or listener changes.
- **Application-only (kept):** `services/python-ai-service/app/data_pipeline.py` — on consumer bootstrap failure the consumer is closed and a WARNING is logged; the service stays healthy without Kafka. This is client resilience, not broker setup. Reverting it would restore “Unclosed AIOKafkaConsumer” and ERROR logs when Kafka is unreachable; optional to revert if you want the old behavior.

---

### Docker images: no custom multi-broker images

- **No custom Kafka or Zookeeper images** are built in this repo. All Kafka/Zookeeper usage is the **standard Confluent images**: `confluentinc/cp-kafka:7.5.0`, `confluentinc/cp-zookeeper:7.5.0` (from Docker Compose and from the commented-out in-cluster manifests).
- **In-cluster Kafka/Zookeeper** are **commented out** in `infra/k8s/base/kustomization.yaml` (`# - zookeeper`, `# - kafka`). The active setup is **external Kafka only**: Docker Compose runs one broker + Zookeeper; K8s uses **kafka-external** (Service + Endpoints to host:29093).
- The **in-cluster** `infra/k8s/base/kafka/deploy.yaml` is a **single broker** (replicas: 1), not multi-broker. It is not applied by default. So there are no "multi-broker Docker images" to revert — only the app-config KAFKA_BROKER list was reverted to a single broker.

### Get unblocked (when kubectl or ensure script fails)

1. **`kubectl get pods` → TLS handshake timeout**  
   Colima (or your k8s VM) is not running. Start it: `colima start`. Wait until `colima status` shows running, then retry `kubectl get pods -n record-platform`.

2. **`./scripts/ensure-all-schemas-and-tuning.sh` hangs on "Port 5433 — records"**  
   Postgres on 5433 is not reachable. The script now does a 5s connect check first and exits with a clear message. Start Docker (and Colima if you use it for k8s), then start the DBs:  
   `docker compose up -d postgres postgres-social postgres-listings postgres-shopping postgres-auth postgres-auction-monitor postgres-analytics postgres-python-ai`  
   Then run the ensure script again.

3. **Order that works:**  
   `colima start` → `docker compose up -d …` (postgres, redis, zookeeper, kafka, etc.) → `./scripts/ensure-all-schemas-and-tuning.sh` → `kubectl get pods -n record-platform`.

---

## Current setup (as of this doc)

### Topology

- **Single broker** in Docker Compose (`docker-compose.yml`).
- **Zookeeper** for broker metadata: `confluentinc/cp-zookeeper:7.5.0`, port 2181.
- **Kafka** `confluentinc/cp-kafka:7.5.0`:
  - **PLAINTEXT** bound to `127.0.0.1:9092` only (healthcheck; not reachable from other containers/host).
  - **SSL** on `0.0.0.0:9093`; host mapping **29093:9093**.
  - **Advertised listeners**: `PLAINTEXT://localhost:9092`, `SSL://192.168.5.1:29093` (clients connect to host IP and port 29093).
  - Inter-broker: PLAINTEXT (localhost only).
  - JKS keystore/truststore from `certs/kafka-ssl/` (dev-root-ca; see `scripts/strict-tls-bootstrap.sh` / reissue flow).

### Clients

- **K8s pods** use `KAFKA_BROKER=kafka-external.record-platform.svc.cluster.local:9093`. The **kafka-external** Service/Endpoints point to the host (e.g. 192.168.5.1:29093) so pods reach the broker over SSL.
- **Node (services/common kafka.ts)**: KafkaJS, `KAFKA_SSL_ENABLED=true`, `rejectUnauthorized: true`, `KAFKA_CA_CERT` from kafka-ssl-secret.
- **Python (python-ai-service)**: aiokafka, `KAFKA_USE_SSL=true`, CA from `/etc/kafka/secrets/ca-cert.pem`. Consumer is optional; service stays up if Kafka is unreachable.

### Replication and topics

- **KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1** (single broker).
- No explicit topic creation doc in repo; topics (e.g. `analytics-searches`, `analytics-predictions`, `ai-events`) are created on first produce or via scripts.

### Docs and scripts

- **docs/STRICT_TLS_MTLS_AND_KAFKA.md** — Strict TLS policy, no cleartext, checklist.
- **scripts/strict-tls-bootstrap.sh** — CA + broker cert, JKS, kafka-ssl-secret.
- **docker-compose.yml** — single kafka + zookeeper, SSL on 9093, host 29093.

---

## Roadmap: multi-broker and production-style Kafka

All communication will use Kafka; below is a concise roadmap for evolving from the current single-broker setup.

### 1. Multi-broker cluster

- Add 2–3 broker nodes (e.g. `kafka-1`, `kafka-2`, `kafka-3` in Docker Compose or K8s).
- Each broker: unique `KAFKA_BROKER_ID`, same Zookeeper cluster.
- **Advertised listeners**: per-broker host/port for SSL (e.g. `SSL://kafka-1:9093`, `SSL://kafka-2:9093`) so clients can bootstrap and then use the cluster.
- Update **kafka-external** (or equivalent) so K8s clients see all brokers (multiple endpoints or a single bootstrap list that resolves to all).

### 2. Replication tuning

- Set **default.replication.factor** (e.g. 2 or 3) so new topics are replicated.
- **KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR** = cluster size (e.g. 3) for fault tolerance.
- **transaction.state.log.replication.factor** = cluster size if using exactly-once (see below).

### 3. ISR tuning

- **min.insync.replicas** (e.g. 2): require at least 2 in-sync replicas for acks; trade off availability vs durability.
- **unclean.leader.election.enable=false** (default): avoid electing out-of-sync replicas.
- Tune **replica.lag.time.max.ms** if needed for large batches or slow replicas.

### 4. Partition strategy (deep dive)

- Define **partitioning key** and **partition count** per topic (e.g. by `user_id`, `tenant_id`, or event type) so related messages stay in order and load spreads.
- Document **partition count** vs consumer count (e.g. at least one partition per consumer in a group for parallelism).
- Consider **compaction** for keyed topics (e.g. user state, configs) vs **retention** for event streams.

### 5. Exactly-once semantics

- Enable **idempotent producer** (`enable.idempotence=true`) to avoid duplicates from retries.
- For **transactional reads/commits**: use Kafka transactions (producer `transactional.id`, consumer `isolation.level=read_committed`).
- Set **transaction.state.log.replication.factor** and **transaction.state.log.min.isr** for the transaction coordinator.

### 6. Schema registry

- Add **Confluent Schema Registry** (or equivalent) for Avro/JSON Schema/Protobuf.
- Producers/consumers register and fetch schemas by id; enforce compatibility (backward/forward/full) per topic.
- Run schema registry as a service (Docker/K8s); configure brokers and clients to use it.

### 7. Kafka Connect

- Run **Kafka Connect** (standalone or distributed) for **source** and **sink** connectors (DB, S3, etc.).
- Use for: ingesting from external systems into Kafka, or sinking from Kafka to DB/warehouse.
- Connectors can use the same SSL and (when added) schema registry.

### 8. MirrorMaker

- Use **MirrorMaker 2** for replication between clusters (e.g. dev → staging, region A → region B).
- Configure source/target clusters, topic patterns, and replication flows.
- Handy for DR, geo distribution, and multi-cluster pipelines.

---

## Suggested order of work

1. **Multi-broker cluster** + **replication tuning** + **ISR** — foundation for HA and durability.
2. **Partition strategy** — document and implement per-topic keys and counts.
3. **Exactly-once** — idempotent producer first; then transactions if needed.
4. **Schema registry** — before adding many new event types.
5. **Kafka Connect** — when you have concrete source/sink needs.
6. **MirrorMaker 2** — when you have a second cluster to replicate to/from.

Current codebase is ready for **strict TLS** and **single broker**; the roadmap above extends it toward a production-style, multi-broker, Kafka-centric communication layer.
