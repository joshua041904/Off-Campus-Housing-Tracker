/**
 * Deterministic NodePort bookkeeping for edge services (registry + history + TTL).
 * Reserved: ingress-nginx/caddy-h3 → TCP 30443, UDP 30444 (k3s / ServiceLB safe split).
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const REG_PATH = join(repoRoot, "bench_logs", "nodeport_registry.json");
const HISTORY_PATH = join(repoRoot, "bench_logs", "nodeport_registry_history.jsonl");

const TTL_MS = 24 * 60 * 60 * 1000;

const RANGES = {
  edge: { start: 30000, end: 30999 },
  internal: { start: 31000, end: 31999 },
};

/** Hard pins — edit here to change canonical edge ports. */
export const RESERVED_PORTS = {
  "ingress-nginx/caddy-h3": { tcp: 30443, udp: 30444, type: "edge" },
};

function now() {
  return Date.now();
}

function appendHistory(entry) {
  mkdirSync(dirname(HISTORY_PATH), { recursive: true });
  appendFileSync(HISTORY_PATH, `${JSON.stringify({ ...entry, ts: now() })}\n`, "utf8");
}

function cleanupRegistry(reg) {
  const cutoff = now() - TTL_MS;
  const cleaned = { services: {} };
  for (const [k, v] of Object.entries(reg.services || {})) {
    if (v.lastUpdated && v.lastUpdated > cutoff) cleaned.services[k] = v;
  }
  return cleaned;
}

export function loadRegistry() {
  try {
    const reg = JSON.parse(readFileSync(REG_PATH, "utf8"));
    return cleanupRegistry(reg);
  } catch {
    return { services: {} };
  }
}

export function saveRegistry(reg) {
  mkdirSync(dirname(REG_PATH), { recursive: true });
  writeFileSync(REG_PATH, `${JSON.stringify(reg, null, 2)}\n`, "utf8");
}

export function getAllNodePortsCluster() {
  try {
    const raw = execFileSync("kubectl", ["get", "svc", "-A", "-o", "json", "--request-timeout=30s"], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    const data = JSON.parse(raw);
    const used = new Set();
    for (const svc of data.items || []) {
      for (const p of svc.spec?.ports || []) {
        if (p.nodePort) used.add(p.nodePort);
      }
    }
    return used;
  } catch {
    return new Set();
  }
}

function findFreePortInRange(used, range) {
  for (let p = range.start; p <= range.end; p++) {
    if (!used.has(p)) return p;
  }
  return null;
}

/**
 * @param {string} ns
 * @param {string} name
 * @param {"edge" | "internal"} [type]
 */
export function allocatePorts(ns, name, type = "edge") {
  const key = `${ns}/${name}`;
  const reg = loadRegistry();

  if (RESERVED_PORTS[key]) {
    const reserved = { ...RESERVED_PORTS[key], lastUpdated: now() };
    reg.services[key] = reserved;
    saveRegistry(reg);
    appendHistory({ service: key, tcp: reserved.tcp, udp: reserved.udp, type: reserved.type, source: "reserved" });
    return { tcp: reserved.tcp, udp: reserved.udp, type: reserved.type };
  }

  const used = getAllNodePortsCluster();
  const range = RANGES[type] || RANGES.edge;
  let tcp = findFreePortInRange(used, range);
  if (!tcp) {
    throw new Error(`no free TCP ports in range ${range.start}-${range.end}`);
  }
  let udp = tcp + 1;
  if (udp > range.end || used.has(udp)) {
    const blocked = new Set(used);
    blocked.add(tcp);
    udp = findFreePortInRange(blocked, range);
  }
  if (!udp || udp === tcp) {
    throw new Error("no free UDP nodePort distinct from TCP");
  }
  const result = { tcp, udp, type, lastUpdated: now() };
  reg.services[key] = result;
  saveRegistry(reg);
  appendHistory({ service: key, tcp, udp, type, source: "dynamic" });
  return { tcp, udp, type };
}

export function getRegisteredPorts(ns, name) {
  const reg = loadRegistry();
  return reg.services[`${ns}/${name}`] || null;
}

/**
 * kubectl json patch https / https-udp nodePorts by port name (stable vs array index).
 * @returns {{ ok: boolean; patched: boolean; message?: string }}
 */
export function patchCaddyHttpsNodePorts(ns, svcName, tcpNp, udpNp) {
  try {
    const raw = execFileSync("kubectl", ["get", "svc", svcName, "-n", ns, "-o", "json", "--request-timeout=20s"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const doc = JSON.parse(raw);
    const ports = doc.spec?.ports || [];
    const patches = [];
    ports.forEach((p, i) => {
      if (p.name === "https" && p.protocol === "TCP" && Number(p.nodePort) !== tcpNp) {
        patches.push({ op: "replace", path: `/spec/ports/${i}/nodePort`, value: tcpNp });
      }
      if (p.name === "https-udp" && p.protocol === "UDP" && Number(p.nodePort) !== udpNp) {
        patches.push({ op: "replace", path: `/spec/ports/${i}/nodePort`, value: udpNp });
      }
    });
    if (!patches.length) {
      return { ok: true, patched: false };
    }
    execFileSync(
      "kubectl",
      ["patch", "svc", svcName, "-n", ns, "--type", "json", "-p", JSON.stringify(patches), "--request-timeout=30s"],
      { stdio: "inherit" },
    );
    appendHistory({
      service: `${ns}/${svcName}`,
      tcp: tcpNp,
      udp: udpNp,
      source: "kubectl_json_patch",
    });
    return { ok: true, patched: true };
  } catch (e) {
    return { ok: false, patched: false, message: e.message };
  }
}

/** Apply reserved split (30443 / 30444) via patch; updates registry + history. */
export function remediateCaddyHttpsReservedPatch() {
  const { tcp, udp } = allocatePorts("ingress-nginx", "caddy-h3", "edge");
  const r = patchCaddyHttpsNodePorts("ingress-nginx", "caddy-h3", tcp, udp);
  return { tcp, udp, patched: r.patched, ok: r.ok, message: r.message };
}

/** Write TTL-cleaned registry (same as loadRegistry cleanup, without merge). */
export function cleanupNodeportRegistryFile() {
  const reg = loadRegistry();
  saveRegistry(reg);
  return { remaining: Object.keys(reg.services || {}).length };
}
