#!/bin/sh
# curl + ca-certificates (+ optional extra packages), grpc-health-probe, then purge curl.
# Requires /tmp/debian-apt-update.sh and /tmp/install-grpc-health-probe.sh (chmod +x).
#
# Usage: install-bookworm-runtime-probe.sh [extra-apt-packages...]
# Env: GRPC_HEALTH_PROBE_VERSION (default v0.4.24)
set -eu

export DEBIAN_FRONTEND=noninteractive

APT_OPTS="-o Acquire::Check-Valid-Until=false -o Acquire::Min-ValidTime=0"

/tmp/debian-apt-update.sh

# shellcheck disable=SC2086
apt-get $APT_OPTS install -y --no-install-recommends curl ca-certificates "$@"

GRPC_HEALTH_PROBE_VERSION="${GRPC_HEALTH_PROBE_VERSION:-v0.4.24}"
export GRPC_HEALTH_PROBE_VERSION
/tmp/install-grpc-health-probe.sh

apt-get purge -y curl
apt-get autoremove -y
rm -rf /var/lib/apt/lists/*
