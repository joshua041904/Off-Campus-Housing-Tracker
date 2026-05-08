#!/usr/bin/env python3
"""Apply a multi-document YAML stream one document at a time (pinpoints first failing chunk).

stdin: full manifest (--- separated)
args: passed to kubectl after \"kubectl\" (e.g. apply -f - --request-timeout=180s)

Exit: first non-zero kubectl apply return code.
"""
from __future__ import annotations

import subprocess
import sys


def split_docs(data: str) -> list[str]:
    docs: list[str] = []
    buf: list[str] = []
    for line in data.splitlines(keepends=True):
        if line.startswith("---") and buf:
            docs.append("".join(buf))
            buf = [line]
        else:
            buf.append(line)
    if buf:
        docs.append("".join(buf))
    out: list[str] = []
    for d in docs:
        d = d.strip()
        if not d:
            continue
        out.append(d if d.startswith("---") else "---\n" + d)
    return out


def main() -> int:
    data = sys.stdin.read()
    if not data.strip():
        print("::error::empty stdin", file=sys.stderr)
        return 2
    kubectl = ["kubectl", *sys.argv[1:]]
    if len(kubectl) < 3:
        print("::error::need kubectl args, e.g. apply -f - --request-timeout=180s", file=sys.stderr)
        return 2
    for i, doc in enumerate(split_docs(data), start=1):
        p = subprocess.run(
            kubectl,
            input=doc.encode(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        sys.stdout.buffer.write(p.stdout)
        sys.stdout.buffer.flush()
        if p.returncode != 0:
            print(
                f"\n::error::kubectl apply failed on YAML document #{i} (exit {p.returncode})\n",
                file=sys.stderr,
            )
            return p.returncode
    return 0


if __name__ == "__main__":
    sys.exit(main())
