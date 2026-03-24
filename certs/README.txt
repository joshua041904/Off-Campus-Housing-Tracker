# TLS certs (generate locally — do not commit keys or keystores)

All private keys (`.key`), keystores (`.jks`), password files, and generated certs under this directory
are **ignored by git**. Generate on each machine:

- `./scripts/dev-generate-certs.sh` — dev CA, leaf, service certs, Envoy client
- `./scripts/kafka-ssl-from-dev-root.sh` — Kafka SSL under `certs/kafka-ssl/` (after CA exists)

If keys were ever pushed to GitHub, **rotate**: re-run the scripts and treat old material as compromised.
See **`docs/SECURITY_CERTS_REPOSITORY.md`** and **`scripts/check-certs-not-in-git.sh`** (optional pre-commit guard).

Expected artifacts (local only): `dev-root.pem`, `dev-root.key`, `off-campus-housing.test.{crt,key}`,
`envoy-client.{crt,key}`, `kafka-ssl/*`, `kafka-dev/*`, etc.
