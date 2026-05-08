#!/usr/bin/env python3
"""
Merge QUIC PCAP parse + capture metadata → quic-invariants.json + quic-transport.prom (OpenMetrics).
Exit 1 when QUIC_FORENSICS_STRICT=1 and invariants fail.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _read_json(p: Path) -> dict:
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return {}


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: quic_invariants_emit.py <transport-forensics-dir>", file=sys.stderr)
        return 2
    d = Path(sys.argv[1]).resolve()
    meta = _read_json(d / "quic-capture-metadata.json")
    parse = _read_json(d / "quic-parse-report.json")

    rules = {
        "must_have_quic_packets": True,
        "must_have_initial": True,
        "must_be_version_v1": True,
        "must_not_have_tcp_443_in_capture": True,
        "must_have_alpn_h3_or_curl_h3_ok": True,
        "curl_http3_exit_zero": True,
    }

    qcount = int(parse.get("quic_packet_count") or 0)
    initial = int(parse.get("quic_initial_packets") or 0)
    ver = str(parse.get("quic_version") or "").strip().lower().replace("0x", "")
    v1 = bool(parse.get("quic_version_v1_seen")) or ver in ("1", "00000001") or ver.startswith("00000001")
    http2 = bool(parse.get("http2_detected"))
    alpn_h3 = bool(parse.get("alpn_h3"))
    curl_h3 = int(meta.get("curl_http3_exit", 1))
    curl_alpn_line = (meta.get("curl_alpn_evidence") or "").lower()
    curl_alpn_ok = "h3" in curl_alpn_line or "http/3" in curl_alpn_line
    capture_filter = (meta.get("capture_filter") or "").lower()
    udp_only = "udp" in capture_filter and "tcp" not in capture_filter

    checks = {
        "quic_packets_gt_0": qcount > 0,
        "initial_gt_0": initial > 0,
        "version_v1": bool(v1),
        "no_http2_frames_in_pcap": not http2,
        "capture_udp_only_implies_no_tcp_443": bool(udp_only),
        "alpn_h3_from_tshark_or_curl": bool(alpn_h3 or curl_alpn_ok or curl_h3 == 0),
        "curl_http3_exit_zero": curl_h3 == 0,
        "pcap_nonempty": int(meta.get("pcap_size_bytes") or 0) > 0,
    }

    strict = os.environ.get("QUIC_FORENSICS_STRICT", "").strip() in ("1", "true", "yes")
    parse_valid = bool(parse.get("valid"))
    transport_ok = bool(parse_valid or alpn_h3 or curl_alpn_ok)
    pass_all = (
        checks["pcap_nonempty"]
        and checks["quic_packets_gt_0"]
        and checks["initial_gt_0"]
        and checks["version_v1"]
        and checks["no_http2_frames_in_pcap"]
        and checks["curl_http3_exit_zero"]
        and transport_ok
    )

    out_inv = {
        "timestamp": meta.get("ended_at"),
        "rules": rules,
        "checks": checks,
        "parse_valid": parse_valid,
        "pass": pass_all,
    }
    (d / "quic-invariants.json").write_text(json.dumps(out_inv, indent=2) + "\n")

    gauge = 1 if pass_all else 0
    prom = (
        "# HELP quic_transport_invariant_pass 1 if QUIC PCAP+curl forensics passed.\n"
        "# TYPE quic_transport_invariant_pass gauge\n"
        f"quic_transport_invariant_pass {gauge}\n"
    )
    (d / "quic-transport.prom").write_text(prom)

    print(json.dumps({"pass": pass_all, "checks": checks}), flush=True)
    if strict and not pass_all:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
