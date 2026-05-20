#!/usr/bin/env bash
# Shared test logging: ERROR / WARN / INFO / OK so we can grep and avoid chasing ghosts.
# Source from test scripts. Env: TEST_LOG_JSON=1 for one-line JSON; TEST_LOG_QUIET=1 for less noise.

_ts() { date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%S"; }

if [[ "${TEST_LOG_JSON:-0}" == "1" ]]; then
  _jmsg() { local level="$1"; shift; printf '{"level":"%s","ts":"%s","msg":"%s"}\n' "$level" "$(_ts)" "$*"; }
  log_error() { _jmsg "ERROR" "$*"; }
  log_warn()  { _jmsg "WARN" "$*"; }
  log_info()  { _jmsg "INFO" "$*"; }
  log_ok()    { _jmsg "OK" "$*"; }
else
  log_error() { printf '\033[31mERROR:\033[0m %s\n' "$*"; }
  log_warn()  { printf '\033[33mWARN:\033[0m %s\n' "$*"; }
  log_info()  { printf '\033[36mINFO:\033[0m %s\n' "$*"; }
  log_ok()    { printf '\033[32mOK:\033[0m %s\n' "$*"; }
fi

# Aliases matching existing script style
say()  { log_info "$*"; }
ok()   { log_ok "$*"; }
warn() { log_warn "$*"; }
fail() { log_error "$*"; exit "${TEST_LOG_FAIL_EXIT:-1}"; }
info() { log_info "$*"; }
