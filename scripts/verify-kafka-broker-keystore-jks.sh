#!/usr/bin/env bash
# Fail fast: Kafka reads kafka.keystore.jks, not kafka-broker.pem. Stale JKS (serverAuth-only) causes
# SSLHandshakeException: Extended key usage does not permit use for TLS client authentication.
#
# Checks:
#   1) Short list contains PrivateKeyEntry (not only trustedCertEntry)
#   2) keytool -list -v shows clientAuth in ExtendedKeyUsages (inter-broker SSL requires it)
#
# Usage (repo root):
#   ./scripts/verify-kafka-broker-keystore-jks.sh
# Env:
#   KAFKA_KEYSTORE_PATH            — default certs/kafka-ssl/kafka.keystore.jks under REPO_ROOT
#   KAFKA_KEYSTORE_PASSWORD_FILE   — default certs/kafka-ssl/kafka.keystore-password
#   KAFKA_KEYSTORE_ALIAS           — default kafka (must exist as PrivateKeyEntry)
#   REPO_ROOT
#   PREFLIGHT_SKIP_KAFKA_JKS_VERIFY=1 — exit 0
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

die() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

[[ "${PREFLIGHT_SKIP_KAFKA_JKS_VERIFY:-0}" == "1" ]] && exit 0

command -v keytool >/dev/null 2>&1 || die "keytool required (install JDK)"

KS="${KAFKA_KEYSTORE_PATH:-$REPO_ROOT/certs/kafka-ssl/kafka.keystore.jks}"
PWFILE="${KAFKA_KEYSTORE_PASSWORD_FILE:-$REPO_ROOT/certs/kafka-ssl/kafka.keystore-password}"
ALIAS="${KAFKA_KEYSTORE_ALIAS:-kafka}"

[[ -f "$KS" ]] || die "Keystore missing: $KS"
[[ -f "$PWFILE" ]] || die "Keystore password file missing: $PWFILE"

# Trim newlines (echo -n in generators; editors may add \n)
PASS="$(tr -d '\r\n' <"$PWFILE")"
[[ -n "$PASS" ]] || die "Empty keystore password in $PWFILE"

short_list="$(keytool -list -keystore "$KS" -storepass "$PASS" -storetype JKS 2>&1)" || die "keytool -list failed (wrong password or corrupt JKS?)"
if ! echo "$short_list" | grep -q "PrivateKeyEntry"; then
  die "Keystore has no PrivateKeyEntry — broker needs key + cert chain (not trustedCertEntry-only). Rebuild JKS: scripts/kafka-ssl-from-dev-root.sh or scripts/dev-generate-certs.sh"
fi
# Default Confluent/docker-compose expects alias kafka (openssl pkcs12 -name kafka).
if ! echo "$short_list" | grep -F "${ALIAS}," | grep -q "PrivateKeyEntry"; then
  die "No PrivateKeyEntry for alias \"$ALIAS\" in $KS (check keytool -list). Expected broker alias matches KAFKA_SSL / docker-compose secrets."
fi

verbose="$(keytool -list -v -keystore "$KS" -storepass "$PASS" -storetype JKS 2>&1)" || die "keytool -list -v failed"

# JDK formats vary; require clientAuth near ExtendedKeyUsages block or as OID 1.3.6.1.5.5.7.3.2 (TLS client)
if echo "$verbose" | grep -qi "ExtendedKeyUsages"; then
  eku_block="$(echo "$verbose" | grep -A12 -i "ExtendedKeyUsages")"
  if ! echo "$eku_block" | grep -qE '(^|[[:space:]])serverAuth([[:space:]]|$)'; then
    die "Keystore broker cert missing serverAuth in ExtendedKeyUsages"
  fi
  if ! echo "$eku_block" | grep -qE '(^|[[:space:]])clientAuth([[:space:]]|$)'; then
    die "Keystore broker cert missing clientAuth in ExtendedKeyUsages (JKS may be stale vs PEM). Delete certs/kafka-ssl/*.jks and run scripts/kafka-ssl-from-dev-root.sh"
  fi
else
  # Some keytool versions spell it differently; fall back: full dump must mention both EKUs
  if ! echo "$verbose" | grep -qE '(^|[[:space:]])serverAuth([[:space:]]|$)|1\.3\.6\.1\.5\.5\.7\.3\.1'; then
    die "Cannot confirm serverAuth EKU in keystore. Inspect: keytool -list -v -keystore $KS"
  fi
  if ! echo "$verbose" | grep -qE '(^|[[:space:]])clientAuth([[:space:]]|$)|1\.3\.6\.1\.5\.5\.7\.3\.2'; then
    die "Cannot confirm clientAuth EKU in keystore (no ExtendedKeyUsages block and no clientAuth OID). Inspect: keytool -list -v -keystore $KS"
  fi
fi

ok "Broker keystore OK: PrivateKeyEntry + serverAuth + clientAuth EKU in $KS"
