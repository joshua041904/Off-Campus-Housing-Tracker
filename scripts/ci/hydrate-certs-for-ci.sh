#!/usr/bin/env bash
# Populate repo certs/ for kafka-health / TLS checks when the checkout has no local keys (typical on GitHub-hosted).
#
# Order:
#   1) POST_DEPLOY_CERTS_ARCHIVE_B64 — gzip tarball (e.g. tar -czf - certs/kafka-ssl certs/dev-root.pem | base64 -w0)
#   2) Secret kafka-ssl-secret → certs/kafka-ssl/* (if kafka-broker.pem missing)
#   3) Secret dev-root-ca → certs/dev-root.pem (if missing; tries HOUSING_NS then ingress-nginx)
#
# If nothing applies, verify-kafka-tls-sans.sh still reads broker PEM via kubectl when the secret exists.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NS="${HOUSING_NS:-off-campus-housing-tracker}"
KSSL="$REPO_ROOT/certs/kafka-ssl"

say() { echo "▶ $*"; }

if [[ -n "${POST_DEPLOY_CERTS_ARCHIVE_B64:-}" ]]; then
  say "Extracting POST_DEPLOY_CERTS_ARCHIVE_B64 into $REPO_ROOT (tar.gz)"
  mkdir -p "$REPO_ROOT"
  echo "$POST_DEPLOY_CERTS_ARCHIVE_B64" | base64 -d | tar -xzf - -C "$REPO_ROOT"
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || { say "kubectl missing — skip cert hydrate"; exit 0; }

if [[ ! -f "$KSSL/kafka-broker.pem" ]]; then
  if kubectl get secret kafka-ssl-secret -n "$NS" --request-timeout=20s >/dev/null 2>&1; then
    say "Hydrating $KSSL from Secret/kafka-ssl-secret (ns=$NS)"
    mkdir -p "$KSSL"
    if command -v python3 >/dev/null 2>&1; then
      kubectl get secret kafka-ssl-secret -n "$NS" -o json --request-timeout=30s \
        | OUT="$KSSL" python3 -c '
import json, sys, os, base64
out = os.environ["OUT"]
data = json.load(sys.stdin).get("data") or {}
for k, v in data.items():
    path = os.path.join(out, k)
    with open(path, "wb") as f:
        f.write(base64.standard_b64decode(v))
print("  wrote", len(data), "keys")
'
    else
      say "python3 not found — cannot decode secret keys in bulk; rely on verify-kafka-tls-sans kubectl path"
    fi
  else
    say "No $KSSL/kafka-broker.pem and no kafka-ssl-secret in $NS — TLS SAN check will use kubectl if secret appears later"
  fi
else
  say "certs/kafka-ssl/kafka-broker.pem already present — skip kafka-ssl-secret hydrate"
fi

if [[ ! -f "$REPO_ROOT/certs/dev-root.pem" ]]; then
  for sns in "$NS" ingress-nginx; do
    if kubectl get secret dev-root-ca -n "$sns" --request-timeout=15s >/dev/null 2>&1; then
      mkdir -p "$REPO_ROOT/certs"
      kubectl get secret dev-root-ca -n "$sns" -o jsonpath='{.data.dev-root\.pem}' --request-timeout=20s \
        | base64 -d >"$REPO_ROOT/certs/dev-root.pem"
      say "Wrote certs/dev-root.pem from Secret/dev-root-ca (ns=$sns)"
      break
    fi
  done
fi

exit 0
