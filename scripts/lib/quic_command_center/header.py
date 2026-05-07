"""Parse QUIC v1 long header fields from UDP payload (unencrypted header portion only)."""
from __future__ import annotations


def parse_long_header(buf: bytes) -> dict | None:
    if len(buf) < 6:
        return None
    first = buf[0]
    if (first & 0x80) == 0:
        return None
    version = int.from_bytes(buf[1:5], "big")
    ptr = 5
    if ptr >= len(buf):
        return None
    dcid_len = buf[ptr]
    ptr += 1
    if ptr + dcid_len > len(buf):
        return None
    dcid = buf[ptr : ptr + dcid_len]
    ptr += dcid_len
    if ptr >= len(buf):
        return None
    scid_len = buf[ptr]
    ptr += 1
    if ptr + scid_len > len(buf):
        return None
    scid = buf[ptr : ptr + scid_len]
    ptr += scid_len
    # QUIC v1 Initial long header: high nibble 0xC (RFC 9000 long header + Initial type).
    is_initial = (first & 0xF0) == 0xC0
    return {
        "version": version,
        "dcid_len": dcid_len,
        "scid_len": scid_len,
        "dcid_hex": dcid.hex(),
        "scid_hex": scid.hex(),
        "is_initial": is_initial,
        "header_consumed": ptr,
    }


def looks_like_quic_v1_short_header(first: bytes) -> bool:
    """Heuristic: QUIC v1 short header has fixed bit (0x40) set and long-form bit clear."""
    if not first:
        return False
    b = first[0]
    if b & 0x80:
        return False
    if (b & 0x40) == 0:
        return False
    return True
