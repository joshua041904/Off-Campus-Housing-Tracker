# Strict TLS/mTLS and Kafka — No Cleartext

Platform policy: **all service-to-service and client-to-broker traffic uses strict TLS or mTLS. No cleartext/plaintext fallback.**

## Where it’s enforced

### Kafka

- **Broker (Docker Compose and in-cluster)**  
  - SSL listener on `0.0.0.0:9093` (host `29093`). All client connections must use this.  
  - **ssl.client.auth=required** (env: `KAFKA_SSL_CLIENT_AUTH: required`). Clients must present a valid client certificate (mTLS); no anonymous SSL.  
  - PLAINTEXT is bound to `127.0.0.1:9092` only (for broker healthcheck); not reachable from other containers or the host.

- **Node (services/common kafka.ts)**  
  - `KAFKA_SSL_ENABLED=true` and `rejectUnauthorized: true`.  
  - If SSL is enabled but no certs are provided, the process throws (no plaintext fallback).  
  - Broker URL must use port **9093** (set in app-config as `KAFKA_BROKER: ...:9093`).

- **Python (python-ai-service data_pipeline.py)**  
  - `KAFKA_USE_SSL=true` with `CERT_REQUIRED` and `check_hostname=True`.  
  - If the CA cert is missing or SSL context creation fails, the process raises (no `CERT_NONE` or unverified fallback).

- **App config (infra/k8s/base/config/app-config.yaml)**  
  - `KAFKA_BROKER` uses port **9093**, `KAFKA_USE_SSL` and `KAFKA_SSL_ENABLED` are **true**.  
  - Every Kafka-consuming deployment must set `KAFKA_CA_CERT` and mount `kafka-ssl-secret` (or equivalent).

### TLS/mTLS (gRPC, Caddy, API)

- **Node**  
  - `NODE_TLS_REJECT_UNAUTHORIZED=1` on all services that do TLS (api-gateway, auth, records, listings, analytics, social, auction-monitor, shopping, python-ai).

- **Secrets**  
  - `service-tls` (leaf + key) and `dev-root-ca` (CA) are used for gRPC and Caddy.  
  - Preflight runs `ensure-strict-tls-mtls-preflight.sh` so the chain is valid and synced.

- **Caddy**  
  - TLS for `off-campus-housing.local`; no `tls internal` without certs. HTTP/3 (QUIC) on same certs.

## Checklist (no cleartext)

- [ ] app-config: `KAFKA_BROKER` port **9093**, `KAFKA_SSL_ENABLED` / `KAFKA_USE_SSL` **true**.
- [ ] Every Kafka consumer/producer deploy: `KAFKA_CA_CERT` set, kafka-ssl volume mounted.
- [ ] Docker Compose Kafka: PLAINTEXT only on `127.0.0.1:9092`; SSL on `0.0.0.0:9093`.
- [ ] Node services: `NODE_TLS_REJECT_UNAUTHORIZED=1`; no `KAFKA_SSL_ENABLED=false`.
- [ ] Preflight: reissue with `KAFKA_SSL=1`, then `ensure-strict-tls-mtls-preflight.sh` (step 5).

## Optional: Kafka broker SSL-only (no PLAINTEXT listener)

To remove the PLAINTEXT listener entirely (e.g. in a locked-down env), switch the broker to SSL-only and set inter-broker to SSL. That requires changing the healthcheck to use `kafka-broker-api-versions --bootstrap-server` over SSL (with truststore). Current setup keeps PLAINTEXT on localhost only so healthcheck stays simple while no client can use cleartext.
