#!/bin/sh
# apt-get update with retries; tolerates Docker/Colima VM clock skew ("InRelease is not valid yet").
# Build context: repo root. Used by service Dockerfiles and envoy-with-tcpdump.
set -eu

export DEBIAN_FRONTEND=noninteractive

APT_OPTS="-o Acquire::Check-Valid-Until=false -o Acquire::Min-ValidTime=0"

attempt=1
max="${DEBIAN_APT_UPDATE_RETRIES:-8}"
while [ "$attempt" -le "$max" ]; do
  if apt-get $APT_OPTS update; then
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep $((attempt * 3))
done

echo "debian-apt-update: apt-get update failed after ${max} attempts" >&2
exit 1
