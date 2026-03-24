# TLS certs (generate locally — do not commit keys or keystores)

All private keys (`.key`), keystores (`.jks`), password files, and generated certs under this directory
are **ignored by git**. Generate on each machine:

- `./scripts/dev-generate-certs.sh` — dev CA, leaf, service certs, Envoy client
- `./scripts/kafka-ssl-from-dev-root.sh` — Kafka SSL under `certs/kafka-ssl/` (after CA exists)

If keys were ever pushed to GitHub, **rotate**: re-run the scripts and treat old material as compromised.
To remove secrets from **git history**, use `git filter-repo` or BFG Repo-Cleaner, then force-push;
see GitHub “Removing sensitive data from a repository”.

Expected artifacts (local only): `dev-root.pem`, `dev-root.key`, `off-campus-housing.test.{crt,key}`,
`envoy-client.{crt,key}`, `kafka-ssl/*`, `kafka-dev/*`, etc.
