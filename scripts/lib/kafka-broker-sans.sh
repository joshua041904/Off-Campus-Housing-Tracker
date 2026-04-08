#!/usr/bin/env bash
# Single source of truth for Kafka broker leaf cert Subject Alternative Names (DNS + fixed/static IPs).
# Used by kafka-ssl-from-dev-root.sh (generation) and verify-kafka-tls-sans.sh (validation).
#
# Cluster access: uses kctl() if the sourcing script defined it (e.g. Colima), else kubectl.
#
# shellcheck shell=bash

och_kafka_kubectl() {
  if declare -F kctl >/dev/null 2>&1; then
    kctl "$@"
  else
    kubectl --request-timeout="${KUBECTL_REQUEST_TIMEOUT:-15s}" "$@"
  fi
}

# One IPv4 per line from kafka-N-external LoadBalancer .status.loadBalancer.ingress[0].ip
och_kafka_metallb_external_lb_ips_lines() {
  local ns="$1" replicas="$2" i _ip
  for ((i = 0; i < replicas; i++)); do
    _ip="$(och_kafka_kubectl get svc "kafka-${i}-external" -n "$ns" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
    if [[ -n "$_ip" && "$_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "$_ip"
    fi
  done
}

# Comma-separated MetalLB IPs (same source merged into KAFKA_SSL_EXTRA_IP_SANS by kafka-ssl-from-dev-root.sh).
och_kafka_metallb_external_lb_ips_csv() {
  local line csv=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    if [[ -n "$csv" ]]; then
      csv+=",${line}"
    else
      csv="$line"
    fi
  done < <(och_kafka_metallb_external_lb_ips_lines "$1" "$2")
  printf '%s' "$csv"
}

# OpenSSL subjectAltName extension value: DNS:* and IP:* entries (comma-separated, no spaces).
# $3 extra_ip_csv — optional comma-separated IPv4s (MetalLB + manual); split and emitted as IP: each.
och_kafka_subject_alt_name_openssl_value() {
  local ns="$1" replicas="$2" extra_ip_csv="${3:-}"
  local -a parts=()
  parts+=("DNS:kafka")
  parts+=("DNS:localhost")
  parts+=("DNS:host.docker.internal")
  parts+=("DNS:kafka-external.${ns}.svc.cluster.local")
  local i
  for ((i = 0; i < replicas; i++)); do
    parts+=("DNS:kafka-${i}")
    parts+=("DNS:kafka-${i}.kafka")
    parts+=("DNS:kafka-${i}.kafka.${ns}.svc")
    parts+=("DNS:kafka-${i}.kafka.${ns}.svc.cluster.local")
    parts+=("DNS:kafka-${i}-external.${ns}.svc.cluster.local")
  done
  parts+=("IP:127.0.0.1")
  parts+=("IP:192.168.5.1")
  if [[ -n "$extra_ip_csv" ]]; then
    local _ip _trimmed
    IFS=',' read -r -a _extra <<< "${extra_ip_csv// /}"
    for _ip in "${_extra[@]}"; do
      _trimmed="${_ip// /}"
      [[ -z "$_trimmed" ]] && continue
      parts+=("IP:${_trimmed}")
    done
  fi
  local IFS=,
  echo "${parts[*]}"
}

# Verification specs: lines "simple|<dns>" (grep DNS:name) or "exact|<token>" (DNS:token boundary — not kafka-0).
och_kafka_emit_san_verify_dns_specs() {
  local ns="$1" replicas="$2" i
  for ((i = 0; i < replicas; i++)); do
    echo "simple|kafka-${i}.kafka.${ns}.svc.cluster.local"
    echo "simple|kafka-${i}-external.${ns}.svc.cluster.local"
    echo "simple|kafka-${i}"
    echo "simple|kafka-${i}.kafka"
    echo "simple|kafka-${i}.kafka.${ns}.svc"
  done
  echo "exact|kafka"
  echo "exact|localhost"
  echo "simple|host.docker.internal"
  echo "simple|kafka-external.${ns}.svc.cluster.local"
}
