#!/usr/bin/env node
/**
 * 7b load-phase transport study — assemble transport-study-v7.json (v7b contract) + optional gates.
 *
 *   node scripts/transport-study-v7b.mjs assemble --v7-input PATH --pcap PATH --out PATH [--enforce-gates]
 *
 * Reads analyzer v7 JSON (from analyze-quic-v7.sh), PCAP for HTTP/2|HTTP/3 counts, Jaeger multi-service overlap.
 * Env: JAEGER_QUERY_BASE (required for assemble unless SKIP_JAEGER=1 for offline tests)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

function getArg(argv, name, def = undefined) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return def;
  const v = argv[i + 1];
  if (typeof v === "string" && v.startsWith("-")) return def;
  return v;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function usage() {
  console.error(`Usage:
  JAEGER_QUERY_BASE=http://host:16686 node scripts/transport-study-v7b.mjs assemble --v7-input PATH --pcap PATH --out PATH [--enforce-gates]
  node scripts/transport-study-v7b.mjs gates --in PATH
`);
}

function tsharkCount(pcap, displayFilter) {
  if (!existsSync(pcap)) return 0;
  try {
    const out = execFileSync(
      "tshark",
      ["-r", pcap, "-Y", displayFilter, "-T", "fields", "-e", "frame.number"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    const lines = out.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return new Set(lines).size;
  } catch {
    return 0;
  }
}

function tsharkUniqStrings(pcap, displayFilter, field) {
  if (!existsSync(pcap)) return [];
  try {
    const out = execFileSync(
      "tshark",
      ["-r", pcap, "-Y", displayFilter, "-T", "fields", "-e", field],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    const s = new Set();
    for (const line of out.split(/\r?\n/)) {
      const v = line.trim();
      if (v) s.add(v);
    }
    return [...s];
  } catch {
    return [];
  }
}

function normalizeBase(b) {
  return String(b || "").replace(/\/+$/, "");
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

const OVERLAP_SERVICES = [
  "api-gateway",
  "auth-service",
  "listings-service",
  "booking-service",
  "analytics-service",
];

/**
 * Step 1–5: query each service for [captureStart-10s, captureEnd+10s] in µs; filter spans with
 * start in [captureStart, captureEnd] seconds (inclusive) per spec (span_start in epoch seconds).
 */
async function jaegerOverlapAggregate(base, captureStartSec, captureEndSec) {
  const startSec = Number(captureStartSec);
  const endSec = Number(captureEndSec);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    return {
      overlap_detected: false,
      trace_ids_within_window: [],
      services_seen: [],
      span_count: 0,
    };
  }

  const queryStartUs = Math.floor((startSec - 10) * 1_000_000);
  const queryEndUs = Math.ceil((endSec + 10) * 1_000_000);

  const traceIdToTrace = new Map();
  for (const svc of OVERLAP_SERVICES) {
    const enc = encodeURIComponent(svc);
    const url = `${base}/api/traces?service=${enc}&start=${queryStartUs}&end=${queryEndUs}&limit=40`;
    let data;
    try {
      data = await fetchJson(url);
    } catch {
      continue;
    }
    for (const tr of data.data || []) {
      if (tr.traceID) traceIdToTrace.set(String(tr.traceID), tr);
    }
  }

  const overlappingTraceIds = new Set();
  const servicesSeen = new Set();
  let spanCount = 0;

  for (const tr of traceIdToTrace.values()) {
    const processes = tr.processes || {};
    const spans = tr.spans || [];
    let anyOverlap = false;
    for (const sp of spans) {
      const stUs = Number(sp.startTime);
      if (!Number.isFinite(stUs)) continue;
      const stSec = stUs / 1_000_000;
      if (stSec >= startSec && stSec <= endSec) {
        anyOverlap = true;
        spanCount += 1;
        const sn = processes[sp.processID]?.serviceName;
        if (sn) servicesSeen.add(sn);
      }
    }
    if (anyOverlap) overlappingTraceIds.add(String(tr.traceID));
  }

  const ids = [...overlappingTraceIds];
  return {
    overlap_detected: ids.length > 0,
    trace_ids_within_window: ids.slice(0, 64),
    services_seen: [...servicesSeen].sort(),
    span_count: spanCount,
  };
}

function buildV7bDoc(v7in, pcapPath, jaegerBlock) {
  const cw = v7in.capture_window || {};
  const s0 = Number(cw.start_epoch);
  const e0 = Number(cw.end_epoch);
  const dur = Number.isFinite(s0) && Number.isFinite(e0) && e0 > s0 ? e0 - s0 : 0;

  const http2Seen = tsharkCount(pcapPath, "tcp.port == 443 && http2");
  const http3Seen = tsharkCount(pcapPath, "udp.port == 443 && quic");

  const alpnSeen = tsharkUniqStrings(
    pcapPath,
    "tls.handshake.extensions_alpn_str",
    "tls.handshake.extensions_alpn_str",
  );
  const cipherSeen = tsharkUniqStrings(pcapPath, "tls.handshake.ciphersuite", "tls.handshake.ciphersuite");
  const tlsIn = v7in.tls || {};
  const alpnProtocolsSeen = [...new Set([...(alpnSeen || []), tlsIn.alpn_protocol].filter(Boolean))];
  const cipherSuitesSeen = [
    ...new Set([...(cipherSeen || []), tlsIn.selected_cipher_suite].filter(Boolean)),
  ].map(String);

  const genAt = new Date().toISOString();

  return {
    valid: Boolean(v7in.valid),
    mode: "load-phase-transport-study",
    capture_window: {
      start_epoch: Number.isFinite(s0) ? s0 : 0,
      end_epoch: Number.isFinite(e0) ? e0 : 0,
      duration_seconds: dur,
    },
    quic: v7in.quic || {
      frame_count: 0,
      versions: [],
      packet_number_spaces: [],
      version_negotiation_packets: 0,
    },
    tls: {
      alpn_protocols_seen: alpnProtocolsSeen,
      cipher_suites_seen: cipherSuitesSeen,
      selected_cipher_suite: tlsIn.selected_cipher_suite ?? null,
      certificate_sha256: tlsIn.certificate_sha256 ?? null,
      alpn_protocol: tlsIn.alpn_protocol ?? null,
    },
    transport_behavior: {
      loss_estimate: v7in.transport_behavior?.loss_estimate ?? 0,
      zero_rtt_detected: v7in.transport_behavior?.zero_rtt_detected ?? v7in.quic?.zero_rtt_detected ?? false,
      spin_bit: v7in.transport_behavior?.spin_bit ?? {
        observed: false,
        transitions: 0,
        estimated_rtt_seconds: null,
      },
      cid_rotation_detected: v7in.connection?.cid_rotation_detected ?? false,
      key_phase_transitions: v7in.connection?.key_phase_transitions ?? 0,
      congestion_estimate_packets_in_flight:
        v7in.transport_behavior?.congestion_estimate_packets_in_flight ?? 0,
      congestion_estimate_heuristic: v7in.transport_behavior?.congestion_estimate_heuristic ?? null,
    },
    http_protocol_proof: {
      http2_seen: http2Seen,
      http3_seen: http3Seen,
    },
    jaeger_correlation: jaegerBlock,
    handshake: v7in.handshake ?? undefined,
    connection: v7in.connection ?? undefined,
    ci_metadata: {
      transport_invariant_version: "v7b",
      generated_at: genAt,
      forensic_upstream: "transport-study-v7b.mjs",
    },
  };
}

function enforceGates(doc) {
  const errs = [];
  const jqLike = (ok, msg) => {
    if (!ok) errs.push(msg);
  };

  jqLike(doc.valid === true, "valid must be true");
  const q = doc.quic || {};
  jqLike((q.frame_count || 0) > 0, "quic.frame_count > 0");
  jqLike((q.version_negotiation_packets || 0) === 0, "version_negotiation_packets == 0");
  const rtt = (q.packet_number_spaces || []).filter((p) => p.space === "1RTT");
  jqLike(rtt.length > 0, "1RTT packet number space required");
  const tb = doc.transport_behavior || {};
  jqLike((tb.loss_estimate || 0) <= 3, "loss_estimate <= 3");
  jqLike((tb.congestion_estimate_packets_in_flight || 0) > 0, "congestion_estimate_packets_in_flight > 0");

  const hp = doc.http_protocol_proof || {};
  jqLike((hp.http2_seen || 0) >= 1, "http_protocol_proof.http2_seen >= 1");
  jqLike((hp.http3_seen || 0) >= 1, "http_protocol_proof.http3_seen >= 1");

  const j = doc.jaeger_correlation || {};
  jqLike(j.overlap_detected === true, "jaeger_correlation.overlap_detected == true");
  jqLike((j.trace_ids_within_window || []).length >= 3, "trace_ids_within_window length >= 3");
  jqLike((j.services_seen || []).length >= 2, "services_seen length >= 2");
  jqLike((j.span_count || 0) >= 5, "span_count >= 5");

  if (errs.length) {
    console.error("transport-study-v7b gates FAILED:");
    for (const e of errs) console.error(`  - ${e}`);
    return false;
  }
  console.log("transport-study-v7b gates: OK");
  return true;
}

async function cmdAssemble(argv) {
  const v7Path = getArg(argv, "--v7-input");
  const pcapPath = getArg(argv, "--pcap");
  const outPath = getArg(argv, "--out");
  if (!v7Path || !pcapPath || !outPath) {
    usage();
    process.exit(2);
  }
  const v7in = JSON.parse(readFileSync(v7Path, "utf8"));
  const base = normalizeBase(process.env.JAEGER_QUERY_BASE || "");
  let jaegerBlock;
  if (!base || process.env.SKIP_JAEGER === "1") {
    jaegerBlock = {
      overlap_detected: false,
      trace_ids_within_window: [],
      services_seen: [],
      span_count: 0,
      note: "JAEGER_QUERY_BASE unset or SKIP_JAEGER=1 — overlap not computed",
    };
  } else {
    const cw = v7in.capture_window || {};
    jaegerBlock = await jaegerOverlapAggregate(base, cw.start_epoch, cw.end_epoch);
  }

  const doc = buildV7bDoc(v7in, pcapPath, jaegerBlock);
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`transport-study-v7b: wrote ${outPath}`);

  if (hasFlag(argv, "--enforce-gates")) {
    const ok = enforceGates(doc);
    process.exit(ok ? 0 : 1);
  }
}

function cmdGates(argv) {
  const p = getArg(argv, "--in");
  if (!p) {
    usage();
    process.exit(2);
  }
  const doc = JSON.parse(readFileSync(p, "utf8"));
  process.exit(enforceGates(doc) ? 0 : 1);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || hasFlag(argv, "-h") || hasFlag(argv, "--help")) {
    usage();
    process.exit(cmd ? 0 : 1);
  }
  if (cmd === "assemble") {
    await cmdAssemble(argv.slice(1));
    return;
  }
  if (cmd === "gates") {
    cmdGates(argv.slice(1));
    return;
  }
  usage();
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
