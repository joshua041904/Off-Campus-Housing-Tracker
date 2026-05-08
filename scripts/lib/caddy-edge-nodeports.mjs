/**
 * Invariants for Caddy edge Service ports 443/TCP + 443/UDP (QUIC).
 * k3s / klipper-lb: TCP and UDP must not share the same nodePort.
 *
 * @param {unknown[]} ports — Service spec.ports from kubectl JSON
 * @returns {{ ok: boolean; reason?: string; tcpNodePort?: number | null; udpNodePort?: number | null; nodePort?: number | null }}
 */
export function analyzeHttpsNodePorts(ports) {
  if (!Array.isArray(ports)) {
    return { ok: false, reason: "svc_missing", tcpNodePort: null, udpNodePort: null, nodePort: null };
  }
  const tcp = ports.find((p) => p.protocol === "TCP" && (p.port === 443 || p.name === "https"));
  const udp = ports.find((p) => p.protocol === "UDP" && (p.port === 443 || p.name === "https-udp"));
  if (!udp) {
    return { ok: false, reason: "udp_port_missing", tcpNodePort: tcp?.nodePort ?? null, udpNodePort: null, nodePort: null };
  }
  if (!udp.nodePort) {
    return {
      ok: false,
      reason: "udp_nodeport_missing",
      tcpNodePort: tcp?.nodePort ?? null,
      udpNodePort: null,
      nodePort: null,
    };
  }
  if (tcp?.nodePort && udp.nodePort === tcp.nodePort) {
    return {
      ok: false,
      reason: "udp_tcp_port_collision",
      tcpNodePort: tcp.nodePort,
      udpNodePort: udp.nodePort,
      nodePort: udp.nodePort,
    };
  }
  return {
    ok: true,
    reason: null,
    tcpNodePort: tcp?.nodePort ?? null,
    udpNodePort: udp.nodePort,
    nodePort: udp.nodePort,
  };
}
