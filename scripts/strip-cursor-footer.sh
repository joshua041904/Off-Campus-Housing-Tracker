#!/bin/sh
# Strip "Made-with: Cursor" line from commit message (used during rebase reword).
FILE="$1"
[ -n "$FILE" ] && [ -f "$FILE" ] || exit 0
perl -i -ne 'print unless /^\s*Made-with:\s*Cursor\s*$/' "$FILE"
