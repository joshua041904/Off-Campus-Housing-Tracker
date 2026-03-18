#!/usr/bin/env python3
"""
Compute TLS handshake timing (ClientHello → ServerHello) from tshark output.
Input: path to file with lines "frame.time_epoch\ttls.handshake.type\ttls.stream"
       (tshark -Y "tls.handshake.type==1 || tls.handshake.type==2"
        -T fields -e frame.time_epoch -e tls.handshake.type -e tls.stream)
Output: JSON with avg, p50, p95, max in milliseconds (to stdout).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"tls_handshake_ms": {"avg": 0, "p50": 0, "p95": 0, "max": 0}}))
        return
    path = Path(sys.argv[1])
    if not path.exists():
        print(json.dumps({"tls_handshake_ms": {"avg": 0, "p50": 0, "p95": 0, "max": 0}}), file=sys.stderr)
        return

    # stream_id -> list of (epoch, type)
    streams: dict[str, list[tuple[float, int]]] = {}
    for line in path.read_text().splitlines():
        parts = line.strip().split("\t")
        if len(parts) < 2:
            continue
        try:
            epoch = float(parts[0])
            msg_type = int(parts[1]) if parts[1] else 0
            stream_id = parts[2].strip() if len(parts) > 2 else ""
            if stream_id not in streams:
                streams[stream_id] = []
            streams[stream_id].append((epoch, msg_type))
        except (ValueError, IndexError):
            continue

    deltas_ms: list[float] = []
    for stream_id, events in streams.items():
        events.sort(key=lambda x: x[0])
        client_hello_time: float | None = None
        for epoch, msg_type in events:
            if msg_type == 1:  # ClientHello
                client_hello_time = epoch
            elif msg_type == 2 and client_hello_time is not None:  # ServerHello
                delta_ms = (epoch - client_hello_time) * 1000
                if delta_ms >= 0 and delta_ms < 60000:  # sanity
                    deltas_ms.append(delta_ms)
                client_hello_time = None  # one delta per stream

    if not deltas_ms:
        result = {"avg": 0, "p50": 0, "p95": 0, "max": 0}
    else:
        deltas_ms.sort()
        n = len(deltas_ms)
        avg = sum(deltas_ms) / n
        p50 = deltas_ms[int(0.5 * n)] if n else 0
        p95 = deltas_ms[int(0.95 * (n - 1))] if n > 1 else (deltas_ms[0] if n else 0)
        max_ms = deltas_ms[-1] if n else 0
        result = {
            "avg": round(avg, 2),
            "p50": round(p50, 2),
            "p95": round(p95, 2),
            "max": round(max_ms, 2),
        }
    out = {"tls_handshake_ms": result}
    print(json.dumps(out))


if __name__ == "__main__":
    main()
