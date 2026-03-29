# Certificates and secrets — Git / GitGuardian

## What was fixed in-repo

- **`.gitignore`** — ignore everything under `certs/**` except **`certs/README.txt`** (nested paths included).
- **`git rm --cached`** — removed TLS keys, keystores (`.jks`), password files, and generated certs from the **index** (your working tree can still have them locally).
- **`certs/README.txt`** — how to regenerate locally; **rotate** if anything was ever pushed; **purge history** if secrets were on GitHub.

## What you must do on GitHub / after a leak

1. **Rotate / regenerate**  
   Treat any key that was on GitHub as **untrusted**. Regenerate the dev CA and leaf/Kafka material with:

   - `./scripts/dev-generate-certs.sh`
   - `./scripts/kafka-ssl-from-dev-root.sh` (after CA exists)

   Re-import into cluster and Docker as in your normal bring-up docs.

2. **Remove secrets from Git history**  
   GitGuardian (and clones) will still see old commits until history is rewritten. Use:

   - [GitHub: Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)  
   - Or [`git filter-repo`](https://github.com/newren/git-filter-repo) to strip paths under `certs/` from all commits, then **force-push** (coordinate with anyone else using the branch).

3. **Optional guard**  
   Run **`./scripts/check-certs-not-in-git.sh`** before commits (or wire into CI / pre-commit) to block committing `*.key` / `*.jks` under `certs/`.

The latest commit only **stops new leaks**; **history rewrite + rotation** closes the incident for scanners and security.
