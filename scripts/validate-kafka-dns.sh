#!/usr/bin/env bash
# Compare live Pod IPs to EndpointSlice addresses for kafka-0..2 (headless Service kafka).
# Stale slices → wrong DNS A records → KRaft :9095 "could not be established".
set -euo pipefail

NAMESPACE="${KAFKA_NAMESPACE:-off-campus-housing-tracker}"
SERVICE_LABEL="kubernetes.io/service-name=kafka"

echo "Checking Kafka headless DNS vs EndpointSlices (namespace=${NAMESPACE})..."

if ! kubectl get ns "$NAMESPACE" >/dev/null 2>&1; then
  echo "Namespace ${NAMESPACE} not found (skip or set KAFKA_NAMESPACE)." >&2
  exit 1
fi

slice_table="$(kubectl get endpointslice -n "$NAMESPACE" -l "$SERVICE_LABEL" -o jsonpath='{range .items[*].endpoints[*]}{.hostname}{"\t"}{.addresses[0]}{"\n"}{end}' 2>/dev/null || true)"
if [[ -z "${slice_table//[$'\t\n']/}" ]]; then
  echo "No EndpointSlice endpoints found for label ${SERVICE_LABEL}. Is Service kafka applied?" >&2
  exit 1
fi

fail=0
for i in 0 1 2; do
  pod="kafka-$i"
  pod_ip="$(kubectl get pod "$pod" -n "$NAMESPACE" -o jsonpath='{.status.podIP}' 2>/dev/null || true)"
  slice_ip="$(printf '%s\n' "$slice_table" | awk -F'\t' -v h="$pod" '$1==h {print $2; exit}')"
  echo "Pod: $pod"
  echo "  live pod IP:     ${pod_ip:-<missing>}"
  echo "  EndpointSlice:   ${slice_ip:-<missing>}"
  if [[ -z "$pod_ip" || -z "$slice_ip" ]]; then
    echo "  status: FAIL (missing IP or slice row)"
    fail=1
  elif [[ "$pod_ip" != "$slice_ip" ]]; then
    echo "  status: FAIL (mismatch — stale EndpointSlice / DNS will lie)"
    fail=1
  else
    echo "  status: OK"
  fi
  echo "-----------------------------"
done

if [[ "$fail" -ne 0 ]]; then
  echo "Kafka DNS / EndpointSlice consistency check FAILED." >&2
  echo "Fix: kubectl delete endpointslice -n ${NAMESPACE} -l ${SERVICE_LABEL}" >&2
  echo "     then kubectl rollout restart statefulset/kafka -n ${NAMESPACE}" >&2
  exit 1
fi

echo "Kafka EndpointSlice addresses match pod IPs."
