# TLS certs (generate locally — do not commit keys or keystores)

All private keys (`.key`), keystores (`.jks`), password files, and generated certs under this directory
are **ignored by git**. Generate on each machine:

- `./scripts/dev-generate-certs.sh` — dev CA, leaf, service certs, Envoy client
- `./scripts/kafka-ssl-from-dev-root.sh` — Kafka SSL under `certs/kafka-ssl/` (after CA exists)
  Broker leaf must include EKU **serverAuth + clientAuth** (Kafka JVM can act as a TLS client); client PEM must include **clientAuth**. Re-run this script after pulling updates if Kafka fails with “Extended key usage does not permit use for TLS client authentication”.
  Verify with: `openssl x509 -in certs/kafka-ssl/kafka-broker.crt -text -noout | grep -A2 "Extended Key Usage"` — you should see both **TLS Web Server Authentication** and **TLS Web Client Authentication** (OpenSSL’s names for serverAuth/clientAuth).

Kafka uses **`certs/kafka-ssl/kafka.keystore.jks`**, not `kafka-broker.pem`. If **`keytool -list -v`** shows `ExtendedKeyUsages [ serverAuth ]` only (no **clientAuth**), delete **`certs/kafka-ssl/*.jks`**, run **`./scripts/kafka-ssl-from-dev-root.sh`** (or **`./scripts/dev-generate-certs.sh`**), confirm PEM/JKS show **TLS Web Client Authentication**, then **`docker compose up -d --force-recreate kafka`**. Scripts now use a dedicated OpenSSL section **`[kafka_broker_tls]`** (not `[v3_req]`) so host **openssl.cnf** cannot strip clientAuth, and they **abort** if the signed PEM lacks clientAuth before building JKS.

After replacing Kafka keystore/truststore files on disk, **recreate** the broker so it loads the new material: `docker compose up -d --force-recreate kafka` (and zookeeper if needed). If you ever give Kafka a **persistent Docker volume** for log data, remove it when rotating certs or fixing a bad broker identity (`docker compose down -v` or delete that volume only); otherwise the JVM can restart-loop on SSL init while health stays “starting”.

If keys were ever pushed to GitHub, **rotate**: re-run the scripts and treat old material as compromised.
See **`docs/SECURITY_CERTS_REPOSITORY.md`** and **`scripts/check-certs-not-in-git.sh`** (optional pre-commit guard).

Expected artifacts (local only): `dev-root.pem`, `dev-root.key`, `off-campus-housing.test.{crt,key}`,
`envoy-client.{crt,key}`, `kafka-ssl/*`, `kafka-dev/*`, etc.
