#!/usr/bin/env bash
# Fast CI/local checks: DB port defaults (5442 listings, 5446 trust), event protos vs Kafka script, service builds.
# Usage: ./scripts/test-housing-stack-wiring.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "❌ $*" >&2; exit 1; }
ok() { echo "✅ $*"; }

grep -q "5442" services/listings-service/src/db.ts || fail "listings db.ts must default to port 5442"
grep -q "LISTINGS_DB_PORT" services/listings-service/src/db.ts || fail "listings db.ts must honor LISTINGS_DB_PORT"
grep -q "5446" services/trust-service/src/db.ts || fail "trust db.ts must default to port 5446"
grep -q "TRUST_DB_PORT" services/trust-service/src/db.ts || fail "trust db.ts must honor TRUST_DB_PORT"

grep -q "listing\.events" services/listings-service/src/grpc-server.ts || fail "listings grpc must publish to *.listing.events (see create-kafka-event-topics.sh)"

"$SCRIPT_DIR/verify-proto-events-topics.sh"

pnpm --filter listings-service build >/dev/null
pnpm --filter trust-service build >/dev/null
pnpm --filter analytics-service build >/dev/null
pnpm --filter api-gateway build >/dev/null
ok "TypeScript build: listings-service, trust-service, analytics-service, api-gateway"

echo "✅ Housing stack wiring checks passed."
