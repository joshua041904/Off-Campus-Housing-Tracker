#!/usr/bin/env bash
# Deprecated name — use test-messaging-service-comprehensive.sh (housing messaging/forum via gateway).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/test-messaging-service-comprehensive.sh" "$@"
