"""RFC 9000 QUIC variable-length integer decode (foundation for deeper parsers)."""
from __future__ import annotations


def decode_varint(buf: bytes, offset: int = 0) -> tuple[int, int]:
    if offset >= len(buf):
        raise ValueError("varint: empty buffer")
    first = buf[offset]
    prefix = first >> 6
    length = 1 << prefix
    if offset + length > len(buf):
        raise ValueError("varint: truncated")
    value = first & 0x3F
    for i in range(1, length):
        value = (value << 8) | buf[offset + i]
    return value, length
