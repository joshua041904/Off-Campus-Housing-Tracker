'use strict';
/**
 * Sidecar: GET /healthz aggregates Ollama HTTP checks for stable kube probes.
 * Uses Node http (no deps). OLLAMA_URL targets the main container on loopback (shared netns).
 * When OLLAMA_WARM_MARKER_PATH is set, the main container must create that file after RAM warm-up
 * (ollama run) so Ready does not mean a cold model behind the load balancer.
 */
const http = require('http');
const fs = require('fs');
const { URL } = require('url');

const OLLAMA_BASE = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const _rawTimeout = parseInt(process.env.OLLAMA_HEALTH_TIMEOUT_MS || '3000', 10) || 3000;
const TIMEOUT_MS = Math.min(120000, Math.max(500, _rawTimeout));

function check(relPath) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    let u;
    try {
      u = new URL(relPath, `${OLLAMA_BASE}/`);
    } catch {
      finish(false);
      return;
    }
    const port = u.port ? parseInt(u.port, 10) : u.protocol === 'https:' ? 443 : 80;
    const req = http.request(
      {
        hostname: u.hostname,
        port,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        timeout: TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        finish(res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on('error', () => finish(false));
    req.on('timeout', () => {
      req.destroy();
      finish(false);
    });
    req.end();
  });
}

/** GET /api/tags and parse JSON body (for model name check). */
function fetchTagsJson() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (out) => {
      if (settled) return;
      settled = true;
      resolve(out);
    };
    let u;
    try {
      u = new URL('/api/tags', `${OLLAMA_BASE}/`);
    } catch {
      finish({ ok: false, data: null });
      return;
    }
    const port = u.port ? parseInt(u.port, 10) : u.protocol === 'https:' ? 443 : 80;
    const chunks = [];
    const req = http.request(
      {
        hostname: u.hostname,
        port,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        timeout: TIMEOUT_MS,
      },
      (res) => {
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const statusOk = res.statusCode >= 200 && res.statusCode < 300;
          if (!statusOk) {
            finish({ ok: false, data: null });
            return;
          }
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            finish({ ok: true, data });
          } catch {
            finish({ ok: false, data: null });
          }
        });
      }
    );
    req.on('error', () => finish({ ok: false, data: null }));
    req.on('timeout', () => {
      req.destroy();
      finish({ ok: false, data: null });
    });
    req.end();
  });
}

function tagsListIncludesModel(data, modelName) {
  if (!modelName || !String(modelName).trim()) return true;
  if (!data || typeof data !== 'object') return false;
  const models = data.models;
  if (!Array.isArray(models)) return false;
  const want = String(modelName).trim();
  return models.some((m) => {
    if (!m || typeof m.name !== 'string') return false;
    const n = m.name;
    return n === want || n.startsWith(`${want}:`);
  });
}

function warmMarkerOk() {
  const p = process.env.OLLAMA_WARM_MARKER_PATH;
  if (!p || !String(p).trim()) return true;
  try {
    return fs.existsSync(String(p).trim());
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const path = req.url ? req.url.split('?')[0] : '';
  if (path === '/livez') {
    // Liveness should only indicate process health, not model warm/readiness.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (path !== '/healthz') {
    res.writeHead(404);
    res.end();
    return;
  }

  const versionOk = await check('/api/version');
  let tagsOk = false;
  let modelListed = true;
  if (versionOk) {
    const tags = await fetchTagsJson();
    tagsOk = tags.ok;
    const model = process.env.OLLAMA_MODEL;
    if (model && String(model).trim()) {
      modelListed = tags.data ? tagsListIncludesModel(tags.data, model) : false;
    }
  }
  const markerOk = warmMarkerOk();
  const ok = Boolean(versionOk && tagsOk && modelListed && markerOk);
  const body = JSON.stringify({
    ok,
    tags: tagsOk,
    modelListed,
    warm: markerOk,
  });

  if (ok) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  } else {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(body);
  }
});

server.listen(8080, '0.0.0.0', () => {
  console.log('ollama-health-proxy on :8080 →', OLLAMA_BASE);
});
