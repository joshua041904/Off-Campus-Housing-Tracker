#!/usr/bin/env bash
# Every *-service (except api-gateway) must expose a gRPC server and match proto/<stem>.proto.
set -euo pipefail
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

fail=0
for svc in services/*-service; do
  [[ -d "$svc" ]] || continue
  name="$(basename "$svc")"
  stem="${name%-service}"
  proto="proto/${stem}.proto"
  if [[ ! -f "${svc}/src/grpc-server.ts" ]]; then
    printf 'verify-housing-grpc-matrix: missing %s/src/grpc-server.ts\n' "$svc" >&2
    fail=1
  fi
  if ! grep -q "startGrpcServer" "${svc}/src/server.ts" 2>/dev/null; then
    printf 'verify-housing-grpc-matrix: missing startGrpcServer in %s/src/server.ts\n' "$svc" >&2
    fail=1
  fi
  if [[ ! -f "$proto" ]]; then
    printf 'verify-housing-grpc-matrix: missing API proto for %s (%s)\n' "$name" "$proto" >&2
    fail=1
  fi
  if ! grep -q "createOchGrpcServerCredentialsForBind" "${svc}/src/grpc-server.ts" 2>/dev/null; then
    printf 'verify-housing-grpc-matrix: %s must use createOchGrpcServerCredentialsForBind in grpc-server.ts\n' "$name" >&2
    fail=1
  fi
done

# Insecure gRPC test bind is read only in services/common (never re-check env in *-service/src).
bad_bind="$(grep -R --include='*.ts' -l 'OCH_GRPC_INSECURE_TEST_BIND' services/*-service/src 2>/dev/null || true)"
if [[ -n "$bad_bind" ]]; then
  printf 'verify-housing-grpc-matrix: OCH_GRPC_INSECURE_TEST_BIND must not appear under services/*-service/src:\n%s\n' "$bad_bind" >&2
  fail=1
fi

# No Kafka noop / bypass reintroduction (broker is required; use ensureKafkaBrokerReady + real Redpanda/Kafka in CI).
bad_kafka="$(grep -R --include='*.ts' -E 'OCH_KAFKA_DISABLED|createNoopKafka|ochKafkaDisabled' services scripts 2>/dev/null || true)"
if [[ -n "$bad_kafka" ]]; then
  printf 'verify-housing-grpc-matrix: forbidden Kafka bypass tokens in services/scripts:\n%s\n' "$bad_kafka" >&2
  fail=1
fi

# Broker TLS EKU regression guard: any Kafka signing line that sets serverAuth must also include clientAuth (strict mTLS).
for _f in scripts/kafka-ssl-from-dev-root.sh scripts/dev-generate-certs.sh scripts/ci/generate-kafka-ci-tls.sh; do
  [[ -f "$_f" ]] || continue
  while IFS= read -r line; do
    case "$line" in
      *extendedKeyUsage*serverAuth*)
        if ! echo "$line" | grep -q clientAuth; then
          printf 'verify-housing-grpc-matrix: broker extendedKeyUsage must include clientAuth: %s → %s\n' "$_f" "$line" >&2
          fail=1
        fi
        ;;
    esac
  done < <(grep -h 'extendedKeyUsage' "$_f" 2>/dev/null || true)
done

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
printf 'verify-housing-grpc-matrix: ok (all *-service gRPC + proto + credential helper + kafka policy)\n'
