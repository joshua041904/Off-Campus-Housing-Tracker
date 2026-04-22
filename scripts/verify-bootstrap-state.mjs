#!/usr/bin/env node
/**
 * Machine-verifiable bootstrap / preflight state contract (JSON to stdout or --json-out).
 *
 * Env:
 *   VERIFY_BOOTSTRAP_CONTEXT — post-bootstrap | preflight-start | preflight-end | drift | ci
 *   PREFLIGHT_RUN_DIR — for preflight-end / drift transport discovery
 *   VERIFY_TRANSPORT_SUMMARY_V7 — explicit path to transport-summary-v7.json (strict transport phase)
 *   HOUSING_NS — default off-campus-housing-tracker
 *   VERIFY_BOOTSTRAP_STATE_SKIP — 1 to exit 0 immediately (shell wrappers)
 *   VERIFY_BOOTSTRAP_INFRA_DEPLOY_WAIT_SEC — max seconds to poll ingress-nginx Deployments (default 45; set 0 for one shot)
 *   VERIFY_BOOTSTRAP_SKIP_CADDY_UDP_NODEPORT_CHECK — 1 skips caddy-h3 UDP 443 / nodePort invariant (emergency only)
 *   VERIFY_BOOTSTRAP_HTTP3_EDGE — 1 runs scripts/verify-http3-and-runtime.mjs (curl --http3 + UDP nodePort + k3s hint → bench_logs/http3_edge_metrics.prom). make cold-bootstrap sets default 1; use 0 to skip. VERIFY_HTTP3_SKIP_CURL=1 skips curl inside that script.
 *   VERIFY_BOOTSTRAP_SKIP_APP_RUNTIME — 1 skips app_runtime phase (emergency only)
 *   VERIFY_APP_RUNTIME_CONFIG — path to infra/app_runtime_services.json (default under repo root)
 *   VERIFY_APP_RUNTIME_PROM_OUT — Prometheus textfile path (default bench_logs/app_runtime_metrics.prom)
 *   VERIFY_APP_RUNTIME_MODE — ci → shorter retries/backoff/rollout/health timeouts (fail-fast gate)
 *   VERIFY_APP_RUNTIME_PHASE — cold | warm | unknown (history JSONL tag; cold-bootstrap sets cold)
 *   VERIFY_APP_RUNTIME_HISTORY / VERIFY_APP_RUNTIME_SKIP_HISTORY — JSONL audit trail for cold vs warm reports
 *   VERIFY_APP_RUNTIME_SERVICES — legacy comma name:port:path (overrides JSON services[])
 *
 * CLI:
 *   node scripts/verify-bootstrap-state.mjs [--json-out PATH] [--context NAME]
 *
 * Exit 1 if any required phase reports ok: false.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

function parseArgs(argv) {
  let jsonOut = "";
  let context = process.env.VERIFY_BOOTSTRAP_CONTEXT || "post-bootstrap";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json-out" && argv[i + 1]) {
      jsonOut = argv[++i];
    } else if (a.startsWith("--context=")) {
      context = a.split("=", 2)[1];
    } else if (a === "--context" && argv[i + 1]) {
      context = argv[++i];
    }
  }
  return { jsonOut, context };
}

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
      ...opts,
    }).trim();
  } catch (e) {
    const stderr = e.stderr?.toString?.() || "";
    const msg = e.message || String(e);
    throw new Error(`${cmd} ${args.join(" ")}: ${msg}${stderr ? `\n${stderr}` : ""}`);
  }
}

function shQuiet(cmd, args) {
  try {
    execFileSync(cmd, args, { encoding: "utf8", stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function sha256File(p) {
  const buf = readFileSync(p);
  return createHash("sha256").update(buf).digest("hex");
}

function phaseOk(skipped = false, detail = {}) {
  return { ok: true, skipped, ...detail };
}

function phaseFail(errors, detail = {}) {
  return { ok: false, errors: Array.isArray(errors) ? errors : [String(errors)], ...detail };
}

function verifyWorkspace() {
  const errors = [];
  const lock = join(repoRoot, "pnpm-lock.yaml");
  if (!existsSync(lock)) errors.push("missing pnpm-lock.yaml");

  const dist = join(repoRoot, "tools/kafka-contract/dist/index.js");
  if (!existsSync(dist) || readFileSync(dist, "utf8").trim().length < 20) {
    errors.push("tools/kafka-contract/dist/index.js missing or too small");
  }

  const venvPy = join(repoRoot, ".venv-kafka-alignment-report/bin/python3");
  const venvPyAlt = join(repoRoot, ".venv-kafka-alignment-report/bin/python");
  const py = existsSync(venvPy) ? venvPy : existsSync(venvPyAlt) ? venvPyAlt : null;
  if (!py) {
    errors.push("missing .venv-kafka-alignment-report/bin/python (run: make kafka-alignment-report-venv)");
  } else {
    try {
      sh(py, ["-c", "import matplotlib; assert matplotlib.__version__"]);
    } catch (e) {
      errors.push(`matplotlib not importable in alignment venv: ${e.message}`);
    }
  }

  if (errors.length) return phaseFail(errors);
  return phaseOk(false, { kafka_contract_dist: relative(repoRoot, dist) });
}

function verifyCryptoDisk() {
  const errors = [];
  const caPem = join(repoRoot, "certs/dev-root.pem");
  const caKey = join(repoRoot, "certs/dev-root.key");
  const leafCrt = join(repoRoot, "certs/off-campus-housing.test.crt");
  const leafKey = join(repoRoot, "certs/off-campus-housing.test.key");

  for (const p of [caPem, caKey, leafCrt, leafKey]) {
    if (!existsSync(p)) errors.push(`missing ${relative(repoRoot, p)}`);
  }
  if (errors.length) return phaseFail(errors);

  try {
    const subj = sh("openssl", ["x509", "-in", caPem, "-noout", "-subject"]).replace(/^subject=\s*/i, "").trim();
    const iss = sh("openssl", ["x509", "-in", caPem, "-noout", "-issuer"]).replace(/^issuer=\s*/i, "").trim();
    if (subj !== iss) errors.push("dev-root.pem is not self-signed (subject !== issuer)");
  } catch (e) {
    errors.push(`openssl CA read failed: ${e.message}`);
  }

  try {
    sh("openssl", ["verify", "-CAfile", caPem, "-untrusted", caPem, leafCrt]);
  } catch (e) {
    errors.push(`leaf chain verify failed: ${e.message}`);
  }

  let endCa = "";
  let endLeaf = "";
  let fpCa = "";
  let fpLeaf = "";
  try {
    endCa = sh("openssl", ["x509", "-in", caPem, "-noout", "-enddate"]);
    endLeaf = sh("openssl", ["x509", "-in", leafCrt, "-noout", "-enddate"]);
    const modCert = sh("openssl", ["x509", "-noout", "-modulus", "-in", leafCrt]).replace(/\s/g, "");
    const modKey = sh("openssl", ["rsa", "-noout", "-modulus", "-in", leafKey]).replace(/\s/g, "");
    if (modCert !== modKey) errors.push("off-campus-housing leaf cert modulus does not match private key");
    fpCa = sha256File(caPem);
    fpLeaf = sha256File(leafCrt);
  } catch (e) {
    errors.push(e.message);
  }

  if (errors.length) return phaseFail(errors);
  return phaseOk(false, {
    dev_root_sha256: fpCa,
    leaf_sha256: fpLeaf,
    ca_enddate: endCa,
    leaf_enddate: endLeaf,
  });
}

function kubectl(args) {
  return sh("kubectl", args);
}

function deploymentReadyReplicas(ns, name) {
  try {
    const specRaw = kubectl(["-n", ns, "get", "deployment", name, "-o", "jsonpath={.spec.replicas}", "--request-timeout=15s"]).trim();
    const readyRaw = kubectl(["-n", ns, "get", "deployment", name, "-o", "jsonpath={.status.readyReplicas}", "--request-timeout=15s"]).trim();
    /** Desired count must come from spec, not status.replicas (surge during rollout can make status.replicas > spec and falsely fail ready >= desired). */
    let desired = parseInt(specRaw, 10);
    if (!Number.isFinite(desired) || desired < 0) desired = 0;
    if (desired === 0) return false;
    const r = parseInt(readyRaw, 10) || 0;
    return r >= desired;
  } catch {
    return false;
  }
}

function sleepSec(seconds) {
  try {
    execFileSync("sleep", [String(seconds)], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
}

/** Poll ingress-nginx edge Deployments until ready or timeout (see VERIFY_BOOTSTRAP_INFRA_DEPLOY_WAIT_SEC). */
function waitIngressNginxDeploymentsReady() {
  const errors = [];
  const ingNs = "ingress-nginx";
  const deploys = ["caddy-h3"];
  const maxSec = parseInt(process.env.VERIFY_BOOTSTRAP_INFRA_DEPLOY_WAIT_SEC || "45", 10);
  if (maxSec <= 0) {
    for (const name of deploys) {
      if (!deploymentReadyReplicas(ingNs, name)) {
        errors.push(`ingress-nginx/${name}: deployment not ready (VERIFY_BOOTSTRAP_INFRA_DEPLOY_WAIT_SEC=0 one-shot)`);
      }
    }
    return errors;
  }
  const deadline = Date.now() + maxSec * 1000;
  while (Date.now() < deadline) {
    let allOk = true;
    for (const name of deploys) {
      if (!deploymentReadyReplicas(ingNs, name)) {
        allOk = false;
        break;
      }
    }
    if (allOk) return errors;
    sleepSec(2);
  }
  for (const name of deploys) {
    if (!deploymentReadyReplicas(ingNs, name)) {
      errors.push(`ingress-nginx/${name}: deployment not ready within ${maxSec}s`);
    }
  }
  return errors;
}

/** QUIC needs UDP 443 published with a nodePort on many k3s / LB setups. */
function checkCaddyH3UdpNodePortInvariant() {
  const errors = [];
  if (process.env.VERIFY_BOOTSTRAP_SKIP_CADDY_UDP_NODEPORT_CHECK === "1") {
    return errors;
  }
  try {
    const raw = kubectl(["-n", "ingress-nginx", "get", "svc", "caddy-h3", "-o", "json", "--request-timeout=15s"]);
    const j = JSON.parse(raw);
    const ports = j.spec?.ports || [];
    const udp = ports.find((p) => p.protocol === "UDP" && (p.port === 443 || p.name === "https-udp"));
    if (!udp) {
      errors.push(
        "ingress-nginx/caddy-h3: no UDP port 443 (https-udp) — HTTP/3 (QUIC) cannot work; add UDP 443 to the Service",
      );
    } else if (!udp.nodePort) {
      errors.push(
        "ingress-nginx/caddy-h3: UDP 443 has no nodePort (k3s/LoadBalancer often omits it unless set) — set nodePort on https-udp; see infra/k8s/loadbalancer.yaml",
      );
    }
  } catch {
    /* Service missing — deployment check already reports readiness issues */
  }
  return errors;
}

function maybeVerifyHttp3Edge() {
  const errors = [];
  if (process.env.VERIFY_BOOTSTRAP_HTTP3_EDGE !== "1") return errors;
  const script = join(repoRoot, "scripts", "verify-http3-and-runtime.mjs");
  if (!existsSync(script)) {
    errors.push(`missing ${relative(repoRoot, script)}`);
    return errors;
  }
  try {
    sh("node", [script], { cwd: repoRoot, env: { ...process.env } });
  } catch (e) {
    errors.push(`HTTP/3 edge verify failed: ${e.message}`);
  }
  return errors;
}

function colimaStatusLooksRunning() {
  try {
    const out = sh("colima", ["status"]);
    return /running/i.test(out);
  } catch {
    return false;
  }
}

function verifyRequiredImages() {
  const script = join(repoRoot, "scripts", "verify-required-images.sh");
  if (!existsSync(script)) {
    return phaseFail([`missing ${relative(repoRoot, script)}`]);
  }
  if (!colimaStatusLooksRunning()) {
    return phaseOk(true, { reason: "Colima not running — C.images verify skipped" });
  }
  try {
    sh("bash", [script], { cwd: repoRoot, env: { ...process.env, REPO_ROOT: repoRoot } });
    return phaseOk(false);
  } catch (e) {
    return phaseFail([
      `G.app_runtime blocked: C.images not satisfied — missing image(s) in Colima VM Docker. ${e.message} Fix: REPO_ROOT=${repoRoot} bash scripts/ensure-required-images.sh (host must have images first; see infra/required_images.json, e.g. SKIP_PATCH=1 bash scripts/ensure-caddy-envoy-tcpdump.sh).`,
    ]);
  }
}

function verifyInfra(ns) {
  if (!shQuiet("kubectl", ["version", "--client"])) {
    return phaseOk(true, { reason: "kubectl not on PATH" });
  }
  const errors = [];
  try {
    kubectl(["get", "nodes", "--request-timeout=15s"]);
  } catch (e) {
    errors.push(`kubectl get nodes: ${e.message}`);
    return phaseFail(errors);
  }

  try {
    kubectl(["get", "crds", "--request-timeout=15s"]);
    const crds = kubectl(["get", "crds", "-o", "jsonpath={.items[*].metadata.name}", "--request-timeout=15s"]);
    if (!crds.includes("ipaddresspools.metallb.io")) {
      errors.push("MetalLB CRD ipaddresspools.metallb.io not registered");
    }
    if (!crds.includes("l2advertisements.metallb.io")) {
      errors.push("MetalLB CRD l2advertisements.metallb.io not registered");
    }
  } catch (e) {
    errors.push(`MetalLB CRD probe: ${e.message}`);
  }

  errors.push(...waitIngressNginxDeploymentsReady());
  errors.push(...checkCaddyH3UdpNodePortInvariant());
  errors.push(...maybeVerifyHttp3Edge());

  if (process.env.VERIFY_BOOTSTRAP_SKIP_KAFKA_STS !== "1") {
    try {
      kubectl(["-n", ns, "get", "statefulset", "kafka", "--request-timeout=15s"]);
    } catch (e) {
      errors.push(`kafka statefulset in ${ns}: ${e.message}`);
    }
  }

  if (errors.length) return phaseFail(errors);
  return phaseOk(false, { housing_ns: ns });
}

function verifyObservability() {
  if (!shQuiet("kubectl", ["version", "--client"])) {
    return phaseOk(true, { reason: "kubectl not on PATH" });
  }
  const errors = [];
  const obsNs = "observability";
  try {
    kubectl(["-n", obsNs, "get", "svc", "jaeger", "--request-timeout=10s"]);
    return phaseOk(false, { jaeger_service_ns: obsNs, name: "jaeger" });
  } catch {
    /* try jaeger-query */
  }
  try {
    kubectl(["-n", obsNs, "get", "svc", "jaeger-query", "--request-timeout=10s"]);
    return phaseOk(false, { jaeger_service_ns: obsNs, name: "jaeger-query" });
  } catch {
    errors.push("no jaeger or jaeger-query Service in observability");
  }
  return phaseFail(errors);
}

function findTransportSummaryV7() {
  const explicit = process.env.VERIFY_TRANSPORT_SUMMARY_V7;
  if (explicit && existsSync(explicit)) return explicit;
  const runDir = process.env.PREFLIGHT_RUN_DIR;
  if (!runDir || !existsSync(runDir)) return null;
  const stack = [runDir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.name === "transport-summary-v7.json") return p;
    }
  }
  return null;
}

function verifyTransportStrict() {
  const path = findTransportSummaryV7();
  if (!path) {
    if (process.env.VERIFY_TRANSPORT_STRICT === "1") {
      return phaseFail(["transport-summary-v7.json required (VERIFY_TRANSPORT_STRICT=1)"]);
    }
    return phaseOk(true, { reason: "no transport-summary-v7.json (set VERIFY_TRANSPORT_SUMMARY_V7 or PREFLIGHT_RUN_DIR)" });
  }
  let j;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return phaseFail([`invalid JSON ${path}: ${e.message}`]);
  }
  const errors = [];
  const q = j.quic || {};
  if ((q.frame_count ?? 0) <= 0) errors.push("quic.frame_count must be > 0");
  if ((q.version_negotiation_packets ?? -1) !== 0) errors.push("quic.version_negotiation_packets must be 0");
  const tls = j.tls || {};
  if (tls.alpn_protocol !== "h3") errors.push(`tls.alpn_protocol must be h3 (got ${tls.alpn_protocol})`);
  if (!tls.selected_cipher_suite) errors.push("tls.selected_cipher_suite missing");
  const proof = j.protocol_proof || {};
  if (proof.curl_http_version_h3 !== "3" && (proof.http3_seen ?? 0) < 1) {
    errors.push("HTTP/3 proof missing (protocol_proof.curl_http_version_h3 or http3_seen)");
  }
  if ((proof.http2_seen ?? 0) < 1 && proof.curl_http_version_h2 !== "2") {
    errors.push("HTTP/2 proof weak (protocol_proof)");
  }
  if (errors.length) return phaseFail(errors, { transport_summary_v7: relative(repoRoot, path) });
  return phaseOk(false, { transport_summary_v7: relative(repoRoot, path) });
}

function verifyKafkaAlignment() {
  const reportDir = join(repoRoot, "bench_logs/kafka-alignment-report");
  if (!existsSync(reportDir)) {
    return phaseOk(true, { reason: "no bench_logs/kafka-alignment-report yet" });
  }
  const csvs = readdirSync(reportDir).filter((f) => f.endsWith(".csv"));
  if (!csvs.length) return phaseOk(true, { reason: "no alignment CSV in kafka-alignment-report" });
  let latest = null;
  let latestM = 0;
  for (const f of csvs) {
    const p = join(reportDir, f);
    const m = statSync(p).mtimeMs;
    if (m >= latestM) {
      latestM = m;
      latest = p;
    }
  }
  const pngs = readdirSync(reportDir).filter((f) => f.endsWith(".png"));
  return phaseOk(false, {
    latest_csv: latest ? relative(repoRoot, latest) : null,
    png_count: pngs.length,
  });
}

function verifyAppRuntime(ns) {
  if (process.env.VERIFY_BOOTSTRAP_SKIP_APP_RUNTIME === "1" || process.env.VERIFY_BOOTSTRAP_SKIP_APP_RUNTIME === "true") {
    return phaseOk(true, { reason: "VERIFY_BOOTSTRAP_SKIP_APP_RUNTIME=1" });
  }
  if (!shQuiet("kubectl", ["version", "--client"])) {
    return phaseOk(true, { reason: "kubectl not on PATH" });
  }
  const script = join(repoRoot, "scripts", "verify-app-runtime.sh");
  if (!existsSync(script)) {
    return phaseFail([`missing ${relative(repoRoot, script)}`]);
  }
  const env = { ...process.env, HOUSING_NS: ns, NAMESPACE: ns };
  try {
    const out = sh("bash", [script], { env, cwd: repoRoot });
    let j;
    try {
      j = JSON.parse(out);
    } catch {
      return phaseFail([`verify-app-runtime: invalid JSON on stdout: ${out.slice(0, 500)}`]);
    }
    if (j.ok === true) return phaseOk(false, { verify_app_runtime: j });
    const errs = Array.isArray(j.errors)
      ? j.errors
      : [typeof j.errors === "string" ? j.errors : JSON.stringify(j)];
    return phaseFail(errs, { verify_app_runtime: j });
  } catch (e) {
    return phaseFail([e.message]);
  }
}

function verifySecretSync(ns) {
  if (!shQuiet("kubectl", ["version", "--client"])) {
    return phaseOk(true, { reason: "kubectl not on PATH" });
  }
  const errors = [];
  for (const name of ["service-tls", "dev-root-ca"]) {
    try {
      kubectl(["-n", ns, "get", "secret", name, "--request-timeout=15s"]);
    } catch (e) {
      errors.push(`missing secret ${ns}/${name}: ${e.message}`);
    }
  }
  try {
    kubectl(["-n", "ingress-nginx", "get", "secret", "dev-root-ca", "--request-timeout=15s"]);
  } catch (e) {
    errors.push(`missing secret ingress-nginx/dev-root-ca: ${e.message}`);
  }
  for (const name of ["kafka-ssl-secret", "och-kafka-ssl-secret"]) {
    try {
      kubectl(["-n", ns, "get", "secret", name, "--request-timeout=15s"]);
    } catch {
      /* optional depending on install */
    }
  }
  if (errors.length) return phaseFail(errors);
  return phaseOk(false, { checked: [`${ns}/service-tls`, `${ns}/dev-root-ca`, "ingress-nginx/dev-root-ca"] });
}

function overallRequired(context, phases) {
  const must = ["workspace", "crypto"];
  if (context === "ci") {
    return must.every((k) => phases[k]?.ok !== false);
  }
  if (context === "preflight-start") {
    return (
      must.every((k) => phases[k]?.ok) &&
      (phases.infra?.ok !== false) &&
      (phases.images?.ok !== false)
    );
  }
  if (context === "post-bootstrap" || context === "drift") {
    const keys = ["workspace", "crypto", "infra", "images", "observability", "secret_sync", "app_runtime"];
    return keys.every((k) => phases[k]?.ok);
  }
  if (context === "preflight-end") {
    const keys = ["workspace", "crypto", "infra", "images", "observability", "secret_sync", "app_runtime"];
    const base = keys.every((k) => phases[k]?.ok);
    const t = phases.transport;
    const transportOk = t?.skipped || t?.ok;
    const k = phases.kafka_alignment;
    const kafkaOk = k?.skipped || k?.ok;
    return base && transportOk && kafkaOk;
  }
  return Object.values(phases).every((p) => p?.skipped || p?.ok);
}

function main() {
  const wallStart = performance.now();
  if (process.env.VERIFY_BOOTSTRAP_STATE_SKIP === "1" || process.env.VERIFY_BOOTSTRAP_STATE_SKIP === "true") {
    const out = {
      contract_version: "v1.0",
      skipped: true,
      phase_results: {},
      overall: true,
      timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  const { jsonOut, context } = parseArgs(process.argv);
  const ns = process.env.HOUSING_NS || process.env.NAMESPACE || "off-campus-housing-tracker";

  const phase_results = {};

  try {
    phase_results.workspace = verifyWorkspace();
  } catch (e) {
    phase_results.workspace = phaseFail([e.message]);
  }

  try {
    phase_results.crypto = verifyCryptoDisk();
  } catch (e) {
    phase_results.crypto = phaseFail([e.message]);
  }

  phase_results.infra = { ok: true, skipped: true };
  phase_results.images = { ok: true, skipped: true };
  phase_results.observability = { ok: true, skipped: true };
  phase_results.secret_sync = { ok: true, skipped: true };
  phase_results.app_runtime = { ok: true, skipped: true };
  phase_results.transport = { ok: true, skipped: true };
  phase_results.kafka_alignment = { ok: true, skipped: true };

  if (context === "ci") {
    /* workspace + crypto only */
  } else if (context === "preflight-start") {
    try {
      phase_results.infra = verifyInfra(ns);
    } catch (e) {
      phase_results.infra = phaseFail([e.message]);
    }
    phase_results.observability = { ok: true, skipped: true, reason: "deferred to suite gates" };
    phase_results.secret_sync = { ok: true, skipped: true };
    phase_results.app_runtime = { ok: true, skipped: true, reason: "deferred until workload gates (preflight-end / post-bootstrap)" };
  } else if (context === "post-bootstrap" || context === "drift" || context === "preflight-end") {
    try {
      phase_results.infra = verifyInfra(ns);
    } catch (e) {
      phase_results.infra = phaseFail([e.message]);
    }
    try {
      phase_results.images = verifyRequiredImages();
    } catch (e) {
      phase_results.images = phaseFail([e.message]);
    }
    try {
      phase_results.observability = verifyObservability();
    } catch (e) {
      phase_results.observability = phaseFail([e.message]);
    }
    try {
      phase_results.secret_sync = verifySecretSync(ns);
    } catch (e) {
      phase_results.secret_sync = phaseFail([e.message]);
    }
    try {
      phase_results.app_runtime = verifyAppRuntime(ns);
    } catch (e) {
      phase_results.app_runtime = phaseFail([e.message]);
    }
    if (context === "preflight-end") {
      phase_results.transport = verifyTransportStrict();
      phase_results.kafka_alignment = verifyKafkaAlignment();
    } else {
      phase_results.transport = { ok: true, skipped: true, reason: "transport proof is preflight-end / strict lifecycle" };
      phase_results.kafka_alignment = verifyKafkaAlignment();
    }
  }

  const overall = overallRequired(context, phase_results);
  const durationMs = Math.round(performance.now() - wallStart);
  const payload = {
    contract_version: "v1.0",
    context,
    housing_ns: ns,
    phase_results,
    overall,
    durationMs,
    timestamp: new Date().toISOString(),
  };

  const text = JSON.stringify(payload, null, 2);
  console.log(text);
  if (jsonOut) {
    mkdirSync(dirname(jsonOut), { recursive: true });
    writeFileSync(jsonOut, text, "utf8");
  }

  process.exit(overall ? 0 : 1);
}

main();
