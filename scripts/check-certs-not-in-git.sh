#!/usr/bin/env bash
# Fail if staged changes add forbidden secret paths under certs/ (run from repo root; optional pre-commit).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

bad=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  [[ "$f" == certs/README.txt ]] && continue
  if [[ "$f" =~ ^certs/ ]] && [[ "$f" =~ \.key$ ]]; then
    echo "❌ Blocked: $f (private key — generate locally; see certs/README.txt)"
    bad=1
  elif [[ "$f" =~ ^certs/ ]] && [[ "$f" =~ \.jks$ ]]; then
    echo "❌ Blocked: $f (keystore)"
    bad=1
  elif [[ "$f" =~ ^certs/ ]] && [[ "$f" =~ password ]]; then
    echo "❌ Blocked: $f (password material)"
    bad=1
  fi
done < <(git diff --cached --name-only 2>/dev/null || true)

[[ "$bad" -eq 0 ]] && exit 0
echo "Remove from index: git rm --cached <path> — see docs/SECURITY_CERTS_REPOSITORY.md"
exit 1
