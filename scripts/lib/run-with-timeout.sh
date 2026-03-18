#!/usr/bin/env bash
# Timeout wrapper that works on macOS without gtimeout
# Usage: run_with_timeout <seconds> <command...>

TIMEOUT_SEC=$1
shift
CMD="$@"

# Start command in background
eval "$CMD" &
CMD_PID=$!

# Start timeout watcher
(
  sleep "$TIMEOUT_SEC"
  if kill -0 "$CMD_PID" 2>/dev/null; then
    echo "Command timed out after ${TIMEOUT_SEC}s, killing..." >&2
    kill -TERM "$CMD_PID" 2>/dev/null
    sleep 2
    kill -KILL "$CMD_PID" 2>/dev/null
  fi
) &
TIMEOUT_PID=$!

# Wait for command to complete
wait "$CMD_PID" 2>/dev/null
EXIT_CODE=$?

# Check if command timed out
if kill -0 "$CMD_PID" 2>/dev/null; then
  # Still running, must have timed out
  kill -KILL "$CMD_PID" 2>/dev/null || true
  EXIT_CODE=124
fi

# Kill timeout watcher
kill "$TIMEOUT_PID" 2>/dev/null || true
wait "$TIMEOUT_PID" 2>/dev/null || true

exit $EXIT_CODE

