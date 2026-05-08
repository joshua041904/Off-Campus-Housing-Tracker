"""Extract UDP/443 payloads from classic PCAP (Ethernet, Linux cooked 'any', loopback)."""

from __future__ import annotations

try:
    import dpkt
except ImportError:  # pragma: no cover
    dpkt = None  # type: ignore


def _ip_from_frame(buf: bytes, dl: int):
    if dpkt is None:
        return None
    # DLT_EN10MB / Ethernet
    if dl in (dpkt.pcap.DLT_EN10MB, 1):
        eth = dpkt.ethernet.Ethernet(buf)
        if isinstance(eth.data, (dpkt.ip.IP, dpkt.ip6.IP6)):
            return eth.data
    # tcpdump -i any on Linux
    if dl in (dpkt.pcap.DLT_LINUX_SLL, 113):
        sll = dpkt.sll.SLL(buf)
        if isinstance(sll.data, (dpkt.ip.IP, dpkt.ip6.IP6)):
            return sll.data
    # Linux cooked capture v2 (tcpdump -i any on newer kernels)
    if dl == 276:
        sll2_mod = getattr(dpkt, "sll2", None)
        if sll2_mod is not None:
            try:
                sll2 = sll2_mod.SLL2(buf)
                if isinstance(sll2.data, (dpkt.ip.IP, dpkt.ip6.IP6)):
                    return sll2.data
            except Exception:
                return None
    # Loopback (some macOS)
    if dl in (dpkt.pcap.DLT_NULL, 0):
        try:
            loop = dpkt.loopback.Loopback(buf)
            if isinstance(loop.data, (dpkt.ip.IP, dpkt.ip6.IP6)):
                return loop.data
        except Exception:
            pass
    return None


def iter_udp_443_payloads(pcap_path: str):
    if dpkt is None:
        raise RuntimeError("dpkt not installed; pip install -r scripts/requirements-transport-forensics.txt")
    with open(pcap_path, "rb") as f:
        r = dpkt.pcap.Reader(f)
        dl = r.datalink()
        for _ts, buf in r:
            ip = _ip_from_frame(buf, dl)
            if ip is None or not isinstance(ip.data, dpkt.udp.UDP):
                continue
            udp = ip.data
            if udp.sport != 443 and udp.dport != 443:
                continue
            yield bytes(udp.data)
