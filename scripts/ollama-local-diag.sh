#!/usr/bin/env bash
# Why `ollama run` fails with "connection reset by peer" on 127.0.0.1:11434:
# Something is bound to 11434 that is NOT a healthy Ollama HTTP server (very often
# an SSH remote forward). The Ollama CLI probes that port and gets RST.
#
# Usage: ./scripts/ollama-local-diag.sh
set -euo pipefail

echo "== Listener on 11434 =="
if command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP:11434 -sTCP:LISTEN 2>/dev/null || echo "(nothing listening on 11434)"
else
  echo "lsof not found; install or use: netstat -anv | grep 11434"
fi

echo
echo "== OLLAMA_HOST =="
echo "${OLLAMA_HOST:-<unset> (defaults to http://127.0.0.1:11434)}"

echo
echo "== Homebrew ollama binary =="
if command -v ollama >/dev/null 2>&1; then
  OLLAMA_HOST=http://127.0.0.1:19998 ollama --version 2>&1 || true
else
  echo "ollama not on PATH"
fi

echo
echo "== What to do =="
echo "1) If LISTEN is 'ssh': stop that port-forward session or use a different local port:"
echo "     OLLAMA_HOST=http://127.0.0.1:11435 ollama serve"
echo "     OLLAMA_HOST=http://127.0.0.1:11435 ollama run llama3.2:1b \"ping\""
echo "2) If nothing listens: start the server, then pull/run:"
echo "     brew services start ollama"
echo "     # or: ollama serve"
echo "     ollama pull llama3.2:1b"
echo "3) Quick probe (no ollama CLI): curl -sS -m 2 http://127.0.0.1:11434/api/version || echo curl_failed"
