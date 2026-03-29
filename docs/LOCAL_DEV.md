# Local dev stack (no k3s)

Run the full stack locally with **strict TLS**: Kafka TLS, gRPC mTLS-ready, Postgres (messaging + media), Redis, MinIO.

## 1. Generate dev certs

```bash
./scripts/dev-generate-certs.sh
```

Creates under `./certs/`:

- **CA:** `dev-root.pem`, `dev-root.key`
- **Services:** `messaging-service.{crt,key}`, `media-service.{crt,key}`
- **Kafka client (Node):** `kafka-dev/ca.pem`, `client.crt`, `client.key`
- **Kafka broker (JKS):** `kafka-ssl/` (keystore, truststore) when `keytool` is available

No plaintext Kafka: clients must use TLS and the broker listens on 9093 (SSL).

## 2. Start the stack

```bash
docker compose -f docker-compose.local.yml up -d
```

Services:

| Service            | Port(s)     | Notes                    |
|--------------------|------------|--------------------------|
| Kafka (SSL)        | 29094→9093 | TLS only                 |
| Zookeeper          | 2181       |                          |
| Redis              | 6380→6379  |                          |
| MinIO              | 9000, 9001 | S3-compat; create bucket `housing-media` |
| Postgres (messaging) | 5444→5432 | DB: `messaging`          |
| Postgres (media)   | 5448→5432 | DB: `media`              |

## 3. Apply DB schemas (once)

```bash
docker compose -f docker-compose.local.yml run --rm init-db
```

Uses SQL from `./infra/db/` (messaging + media + outbox).

## 4. Create MinIO bucket (for media-service)

```bash
docker compose -f docker-compose.local.yml exec minio mc alias set local http://localhost:9000 minio minio123
docker compose -f docker-compose.local.yml exec minio mc mb local/housing-media
```

Or use MinIO console: http://localhost:9001

## 5. Run tests

- **Unit (no stack):**  
  `pnpm --filter "@common/utils" run test`  
  `pnpm --filter media-service run test`  
  `pnpm --filter event-layer-verification run test`

- **Integration (stack up):** run service tests that need Postgres/Kafka/MinIO after `up` and `init-db`.

## 6. Tear down

```bash
docker compose -f docker-compose.local.yml down -v
```

## CI

GitHub-hosted **och-ci** (`.github/workflows/ci.yml`) does not assume a k3s cluster: protocol anomaly gate, service build/test matrix, Python transport tooling checks, QUIC hostname static invariant. Strict Playwright runs only when the repository variable **`RUN_STRICT_PLAYWRIGHT`** is `true` (e.g. self-hosted runner that can reach the edge).

For local TLS + `docker-compose.local.yml` integration, run the same flows manually (certs, compose up, `init-db`, then `pnpm --filter … test`) — there is no longer a dedicated “local stack” workflow on `ubuntu-latest`.
