#!/usr/bin/env bash
# Times /api/generate from inside analytics-service (same cluster DNS as listing-feel).
#
# Always sets options.num_predict — without it, CPU-only Ollama can run a very long decode
# and Node's http.request has no default socket timeout, so kubectl exec looks "hung".
#
# Usage:
#   ./scripts/k8s-ollama-generate-smoke.sh
#   K8S_NAMESPACE=my-ns OLLAMA_SMOKE_NUM_PREDICT=64 OLLAMA_SMOKE_TIMEOUT_MS=120000 ./scripts/k8s-ollama-generate-smoke.sh
set -euo pipefail
NS="${K8S_NAMESPACE:-off-campus-housing-tracker}"
kubectl exec -n "$NS" deploy/analytics-service -c app -- node -e "
const http = require('http');
const model = process.env.OLLAMA_MODEL || 'llama3.2:1b';
const predict = Math.min(512, Math.max(8, parseInt(process.env.OLLAMA_SMOKE_NUM_PREDICT || '128', 10) || 128));
const timeoutMs = Math.min(600000, Math.max(5000, parseInt(process.env.OLLAMA_SMOKE_TIMEOUT_MS || '180000', 10) || 180000));
const data = JSON.stringify({
  model,
  prompt: 'Short test. Reply in at most six words.',
  stream: false,
  options: { num_predict: predict, temperature: 0.35 },
});
const t0 = Date.now();
const req = http.request(
  {
    hostname: 'ollama',
    port: 11434,
    path: '/api/generate',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
    timeout: timeoutMs,
  },
  (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const elapsed = Date.now() - t0;
      console.log('status=' + res.statusCode + ' elapsed_ms=' + elapsed + ' num_predict=' + predict);
      if (res.statusCode !== 200) {
        process.stdout.write(Buffer.concat(chunks).toString('utf8').slice(0, 800) + '\\n');
        process.exit(1);
      }
    });
  }
);
req.on('timeout', () => {
  req.destroy();
  console.error('client socket timeout after ' + timeoutMs + 'ms');
  process.exit(1);
});
req.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
req.write(data);
req.end();
"
