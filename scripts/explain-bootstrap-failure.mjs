#!/usr/bin/env node
/**
 * Heuristic summary of bootstrap failures from bootstrap_state_progress.json + bootstrap_errors/*.log
 *
 * Writes:
 *   bench_logs/bootstrap_failure_summary.json
 *   bench_logs/bootstrap_failure_summary.txt
 *
 * Env: VERIFY_BOOTSTRAP_PROGRESS, VERIFY_BOOTSTRAP_ERRORS_DIR, BOOTSTRAP_FAILURE_SUMMARY_JSON, BOOTSTRAP_FAILURE_SUMMARY_TXT
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const progressPath =
  process.env.VERIFY_BOOTSTRAP_PROGRESS || join(repoRoot, "bench_logs/bootstrap_state_progress.json");
const errDir = process.env.VERIFY_BOOTSTRAP_ERRORS_DIR || join(repoRoot, "bench_logs/bootstrap_errors");
const outJson =
  process.env.BOOTSTRAP_FAILURE_SUMMARY_JSON || join(repoRoot, "bench_logs/bootstrap_failure_summary.json");
const outTxt =
  process.env.BOOTSTRAP_FAILURE_SUMMARY_TXT || join(repoRoot, "bench_logs/bootstrap_failure_summary.txt");

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function readLogSnippets() {
  if (!existsSync(errDir)) return [];
  const out = [];
  for (const f of readdirSync(errDir)) {
    if (!f.endsWith(".log")) continue;
    const p = join(errDir, f);
    try {
      const content = readFileSync(p, "utf8");
      out.push({ file: f, path: p, tail: content.slice(-2000) });
    } catch {
      /* skip */
    }
  }
  return out;
}

function classify(messages, tails) {
  const blob = `${messages} ${tails}`.toLowerCase();
  if (blob.includes("colima") || blob.includes("k3s") || blob.includes("kubelet")) return "Colima / k3s substrate";
  if (blob.includes("jaeger")) return "Observability (Jaeger) not reachable";
  if (blob.includes("connection refused") || blob.includes("econnrefused")) return "Service not ready / network refused";
  if (blob.includes("kafka") || blob.includes("9093") || blob.includes("strimzi")) return "Kafka cluster or TLS issue";
  if (blob.includes("imagepull") || blob.includes("image pull") || blob.includes("errimagepull"))
    return "Image pull / registry (DAG C.images: Colima VM Docker missing image)";
  if (blob.includes("crashloop") || blob.includes("crash loop")) return "Pod CrashLoopBackOff";
  if (blob.includes("not ready") || blob.includes("readiness")) return "Readiness probe / rollout not complete";
  return "Unknown (inspect logs)";
}

function suggest(root) {
  switch (root) {
    case "Colima / k3s substrate":
      return "Try: colima delete -f && BOOTSTRAP_CONFIRM=yes make bootstrap (or full make cold-bootstrap). See docs/COLIMA_INTERRUPT_RECOVERY.md.";
    case "Observability (Jaeger) not reachable":
      return "Prefer edge Jaeger: JAEGER_QUERY_BASE=https://off-campus-housing.test/jaeger (Caddy + QUERY_BASE_PATH). Else: kubectl -n observability port-forward svc/jaeger 16686:16686; make validate-observability.";
    case "Service not ready / network refused":
      return "kubectl get pods -n $HOUSING_NS -o wide; kubectl logs deploy/<name> --tail=200; tune VERIFY_APP_RUNTIME_* timeouts.";
    case "Kafka cluster or TLS issue":
      return "make verify-kafka-tls-sans; check kafka-ssl-secret and broker SANs; kafka-tls-guard logs.";
    case "Image pull / registry (DAG C.images: Colima VM Docker missing image)":
      return "DAG C.images: build on host then load into Colima VM Docker — REPO_ROOT=. bash scripts/ensure-required-images.sh (after docker build per infra/required_images.json). Bootstrap runs this after P6; for ingress only: SKIP_PATCH=1 bash scripts/ensure-caddy-envoy-tcpdump.sh.";
    case "Pod CrashLoopBackOff":
      return "kubectl describe pod <pod>; check env mounts, DB connectivity, and recent deploy-dev output.";
    case "Readiness probe / rollout not complete":
      return "kubectl get deploy -n $HOUSING_NS; widen rollout deadline or fix upstream (DB/Kafka) before health checks.";
    default:
      return "Inspect bench_logs/bootstrap_errors/*.log and bench_logs/bootstrap_state_progress.json failed[].";
  }
}

function main() {
  mkdirSync(dirname(outJson), { recursive: true });
  if (!existsSync(progressPath)) {
    const skip = { ok: true, skipped: "no_progress_file", path: progressPath, failed_nodes: [] };
    writeFileSync(outJson, JSON.stringify(skip, null, 2), "utf8");
    writeFileSync(outTxt, `OK: no progress file at ${progressPath}\n`, "utf8");
    console.log(JSON.stringify(skip, null, 2));
    return;
  }
  const progress = readJson(progressPath, { completed: [], failed: [] });
  const failed = Array.isArray(progress.failed) ? progress.failed : [];
  if (!failed.length) {
    const ok = { ok: true, message: "No failures in bootstrap_state_progress.json", failed_nodes: [] };
    writeFileSync(outJson, JSON.stringify(ok, null, 2), "utf8");
    writeFileSync(outTxt, "OK: no recorded bootstrap failures.\n", "utf8");
    console.log(JSON.stringify(ok, null, 2));
    return;
  }

  const logs = readLogSnippets();
  const messages = failed.map((f) => (typeof f === "object" && f?.message ? f.message : String(f))).join(" | ");
  const tails = logs.map((l) => l.tail).join("\n");
  const root = classify(messages, tails);
  const summary = {
    ok: false,
    root_cause: root,
    failed_nodes: failed.map((f) => (typeof f === "object" && f?.node ? f.node : String(f))),
    messages: failed.map((f) => (typeof f === "object" ? { node: f.node, message: f.message, logFile: f.logFile } : f)),
    log_snippets: logs.map((l) => ({ file: l.file, bytes: l.tail.length })),
    suggestion: suggest(root),
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(outJson, JSON.stringify(summary, null, 2), "utf8");
  const text = [
    `Bootstrap failure summary (${summary.generatedAt})`,
    `Root cause (heuristic): ${root}`,
    `Failed nodes: ${summary.failed_nodes.join(", ")}`,
    "",
    "Suggested fix:",
    summary.suggestion,
    "",
    "Messages:",
    ...failed.map((f) =>
      typeof f === "object" ? `  - ${f.node}: ${f.message || ""}${f.logFile ? ` (log: ${f.logFile})` : ""}` : `  - ${f}`
    ),
    "",
    "Error log tails indexed:",
    ...logs.map((l) => `  === ${l.file} ===\n${l.tail}\n`),
  ].join("\n");
  writeFileSync(outTxt, text, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main();
