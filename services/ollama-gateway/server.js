/**
 * Ollama gateway: Prometheus /metrics, micro-batching /generate, Redis semantic cache (scan + RediSearch),
 * model routing, SSE streaming, optional Kafka async for heavy prompts + GET /result/:id.
 */
import fs from 'fs';
import http from 'http';
import { Counter, Histogram, Registry } from 'prom-client';
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import { randomUUID } from 'crypto';

const OLLAMA = (process.env.OLLAMA_URL || 'http://ollama:11434').replace(/\/$/, '');
const FAST_MODEL = process.env.OLLAMA_FAST_MODEL || process.env.OLLAMA_MODEL || 'llama3.2:1b';
const SMART_MODEL = process.env.OLLAMA_SMART_MODEL || 'llama3:8b';
const REDIS_URL = (process.env.REDIS_URL || '').trim();
const KAFKA_BROKER_DEFAULT =
  'kafka-0.kafka:9093,kafka-1.kafka:9093,kafka-2.kafka:9093,kafka-0.kafka-headless:9093,kafka-1.kafka-headless:9093,kafka-2.kafka-headless:9093';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || KAFKA_BROKER_DEFAULT)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const KAFKA_ENABLED = process.env.KAFKA_ENABLED !== '0' && KAFKA_BROKERS.length > 0;
const JOBS_TOPIC = process.env.OLLAMA_JOBS_TOPIC || 'ollama-jobs';
const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIM || '768', 10) || 768;
const CACHE_SIM = parseFloat(process.env.CACHE_SIM_THRESHOLD || '0.92', 10);
const KNN_MAX_DIST = parseFloat(process.env.CACHE_KNN_MAX_DIST || '0.35', 10);
const HEAVY_LEN = parseInt(process.env.HEAVY_PROMPT_MIN_LEN || '300', 10) || 300;
const BATCH_MS = parseInt(process.env.BATCH_FLUSH_MS || '50', 10) || 50;
const BATCH_ENABLE = process.env.BATCH_ENABLE !== '0';
const FT_INDEX = process.env.REDIS_FT_INDEX || 'idx:cache';
const PORT = parseInt(process.env.PORT || '8081', 10) || 8081;

/** KafkaJS ssl: mTLS object when cert paths exist, else boolean (TLS without client certs). */
function loadKafkaJsSslOption() {
  if (process.env.KAFKA_SSL_ENABLED === 'false') return false;
  const caPath = process.env.KAFKA_CA_CERT || process.env.KAFKA_SSL_CA_PATH;
  const certPath = process.env.KAFKA_CLIENT_CERT || process.env.KAFKA_SSL_CERT_PATH;
  const keyPath = process.env.KAFKA_CLIENT_KEY || process.env.KAFKA_SSL_KEY_PATH;
  if (caPath && certPath && keyPath) {
    try {
      const base = {
        rejectUnauthorized: true,
        ca: [fs.readFileSync(caPath, 'utf8')],
        cert: fs.readFileSync(certPath, 'utf8'),
        key: fs.readFileSync(keyPath, 'utf8'),
      };
      if (process.env.KAFKA_SSL_SKIP_HOSTNAME_CHECK === '1') {
        return { ...base, checkServerIdentity: () => undefined };
      }
      return base;
    } catch (e) {
      console.warn('[ollama-gateway] kafka TLS file read failed, using ssl:true', e?.message || e);
    }
  }
  return process.env.KAFKA_SSL_ENABLED !== 'false';
}

const registry = new Registry();
const requestCount = new Counter({
  name: 'ollama_requests_total',
  help: 'Total gateway requests',
  registers: [registry],
});
const latency = new Histogram({
  name: 'ollama_latency_ms',
  help: 'End-to-end latency ms (non-cached, non-202)',
  buckets: [50, 100, 200, 500, 1000, 2000, 5000, 15000],
  registers: [registry],
});
const cacheHits = new Counter({
  name: 'ollama_cache_hits_total',
  help: 'Semantic cache hits',
  registers: [registry],
});
const batchRuns = new Counter({
  name: 'ollama_gateway_batch_flushes_total',
  help: 'Micro-batch flush operations',
  registers: [registry],
});

/** @type {Redis | null} */
let redis = null;
let ftReady = false;
/** @type {import('kafkajs').Producer | null} */
let producer = null;

const batchQueue = [];
let batchTimer = null;
let batchFlushing = false;

function pickModel(prompt) {
  if (!prompt || prompt.length < 120) return FAST_MODEL;
  if (/analyze|explain|compare|why|report|deep/i.test(prompt)) return SMART_MODEL;
  return FAST_MODEL;
}

function isHeavy(prompt) {
  return (prompt && prompt.length >= HEAVY_LEN) || /analyze|report|deep/i.test(prompt || '');
}

function cosineSim(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

async function ollamaFetch(path, opts = {}) {
  const u = new URL(path, `${OLLAMA}/`);
  const r = await fetch(u, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return r;
}

async function embed(text) {
  const r = await ollamaFetch('/api/embeddings', {
    method: 'POST',
    body: { model: FAST_MODEL, prompt: text },
  });
  if (!r.ok) throw new Error(`embeddings ${r.status}`);
  const data = await r.json();
  const emb = data.embedding;
  if (!Array.isArray(emb)) throw new Error('no embedding');
  return emb;
}

async function ensureFtIndex() {
  if (!redis || ftReady) return;
  try {
    const args = [
      'FT.CREATE',
      FT_INDEX,
      'ON',
      'HASH',
      'PREFIX',
      '1',
      'cache:',
      'SCHEMA',
      'embedding',
      'VECTOR',
      'FLAT',
      '6',
      'TYPE',
      'FLOAT32',
      'DIM',
      String(EMBEDDING_DIM),
      'DISTANCE_METRIC',
      'COSINE',
      'response',
      'TEXT',
    ];
    await redis.call(...args);
  } catch (e) {
    const msg = String(e?.message || e);
    if (!msg.includes('Index already exists')) {
      console.warn('FT.CREATE skipped:', msg);
    }
  }
  ftReady = true;
}

async function vectorSearchFt(vec) {
  if (!redis || vec.length !== EMBEDDING_DIM) return null;
  const blob = Buffer.from(Float32Array.from(vec).buffer);
  try {
    const res = await redis.call(
      'FT.SEARCH',
      FT_INDEX,
      '*=>[KNN 1 @embedding $vec AS dist]',
      'PARAMS',
      '2',
      'vec',
      blob,
      'SORTBY',
      'dist',
      'RETURN',
      '2',
      'response',
      'dist',
      'DIALECT',
      '2'
    );
    const n = Number(res[0]);
    if (!n || n < 1) return null;
    const fields = res[2];
    if (!Array.isArray(fields)) return null;
    const map = {};
    for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];
    const dist = parseFloat(map.dist);
    const response = map.response;
    if (Number.isFinite(dist) && dist <= KNN_MAX_DIST && typeof response === 'string') {
      return response;
    }
  } catch (e) {
    console.warn('FT.SEARCH failed:', e?.message || e);
  }
  return null;
}

function bufToVec(buf) {
  if (!buf || buf.length < 4 || buf.length % 4 !== 0) return null;
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  return Array.from(f);
}

async function scanCacheHit(vec) {
  if (!redis) return null;
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'cache:*', 'COUNT', '80');
    cursor = next;
    for (const key of keys) {
      const t = await redis.type(key);
      if (t === 'string') {
        const raw = await redis.get(key);
        if (!raw) continue;
        try {
          const row = JSON.parse(raw);
          if (Array.isArray(row.embedding) && cosineSim(vec, row.embedding) > CACHE_SIM) {
            return row.response;
          }
        } catch {
          /* skip */
        }
      } else if (t === 'hash') {
        const embBuf = await redis.hgetBuffer(key, 'embedding');
        const resp = await redis.hget(key, 'response');
        const ev = bufToVec(embBuf);
        if (ev && typeof resp === 'string' && cosineSim(vec, ev) > CACHE_SIM) {
          return resp;
        }
      }
    }
  } while (cursor !== '0');
  return null;
}

async function tryCache(vec) {
  if (!vec) return null;
  await ensureFtIndex();
  const ft = await vectorSearchFt(vec);
  if (ft) return ft;
  return scanCacheHit(vec);
}

async function setCacheJson(vec, response) {
  if (!redis || !vec) return;
  const key = `cache:${Date.now()}-${randomUUID().slice(0, 8)}`;
  await redis.set(key, JSON.stringify({ embedding: vec, response }), 'EX', 3600);
}

async function setCacheHash(vec, response) {
  if (!redis || !vec || vec.length !== EMBEDDING_DIM) return;
  await ensureFtIndex();
  const id = `cache:${Date.now()}-${randomUUID().slice(0, 8)}`;
  const blob = Buffer.from(Float32Array.from(vec).buffer);
  await redis.hset(id, 'embedding', blob, 'response', String(response));
  await redis.expire(id, 3600);
}

async function storeCached(vec, response) {
  if (!vec) return;
  try {
    await setCacheHash(vec, response);
  } catch (e) {
    console.warn('hash cache store failed, json fallback:', e?.message || e);
    await setCacheJson(vec, response);
  }
}

function scheduleBatchFlush() {
  if (!BATCH_ENABLE || batchTimer) return;
  batchTimer = setTimeout(() => {
    batchTimer = null;
    void flushBatchQueue();
  }, BATCH_MS);
}

async function flushBatchQueue() {
  if (batchFlushing || batchQueue.length === 0) return;
  batchFlushing = true;
  const batch = batchQueue.splice(0, batchQueue.length);
  batchRuns.inc();
  const model = batch.some((b) => pickModel(b.prompt) === SMART_MODEL) ? SMART_MODEL : FAST_MODEL;
  const merged = batch.map((b) => b.prompt).join('\n');
  try {
    const r = await ollamaFetch('/api/generate', {
      method: 'POST',
      body: { model, prompt: merged, stream: false },
    });
    const data = await r.json();
    const parts = String(data.response || '').split('\n');
    batch.forEach((job, i) => {
      job.resolve(parts[i] ?? data.response);
    });
  } catch (e) {
    batch.forEach((job) => job.reject(e));
  } finally {
    batchFlushing = false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const max = 2 * 1024 * 1024;
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > max) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

async function main() {
  if (REDIS_URL) {
    const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
    client.on('error', (err) => {
      console.warn('[ollama-gateway] redis:', err?.message || err);
    });
    try {
      await client.connect();
      redis = client;
    } catch (e) {
      console.warn('Redis connect failed, continuing without cache:', e?.message || e);
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
      redis = null;
    }
  }

  if (KAFKA_ENABLED) {
    const kafka = new Kafka({
      clientId: 'ollama-gateway',
      brokers: KAFKA_BROKERS,
      ssl: loadKafkaJsSslOption(),
      connectionTimeout: Number(process.env.KAFKAJS_CONNECTION_TIMEOUT_MS || '4000'),
    });
    producer = kafka.producer({ allowAutoTopicCreation: true });
    await producer.connect().catch((e) => {
      console.warn('Kafka producer connect failed, async heavy path disabled:', e?.message || e);
      producer = null;
    });
  }

  if (BATCH_ENABLE) {
    setInterval(() => {
      void flushBatchQueue();
    }, BATCH_MS);
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/metrics' || req.url?.startsWith('/metrics?'))) {
        res.setHeader('Content-Type', registry.contentType);
        res.end(await registry.metrics());
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/result/')) {
        const id = req.url.split('/')[2]?.split('?')[0];
        if (!id || !redis) {
          res.writeHead(!redis ? 503 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: !redis ? 'redis unavailable' : 'bad job id' }));
          return;
        }
        const raw = await redis.get(`job:${id}`);
        if (!raw) {
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'processing' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(raw);
        return;
      }

      if (req.method !== 'POST' || req.url !== '/generate') {
        res.writeHead(404);
        res.end();
        return;
      }

      const start = Date.now();
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }

      const { prompt, stream } = body;
      if (!prompt || typeof prompt !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'prompt required' }));
        return;
      }

      requestCount.inc();

      if (!stream && isHeavy(prompt) && producer) {
        const jobId = randomUUID();
        try {
          await producer.send({
            topic: JOBS_TOPIC,
            messages: [{ key: jobId, value: JSON.stringify({ jobId, prompt, model: SMART_MODEL }) }],
          });
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jobId, status: 'queued' }));
          return;
        } catch (e) {
          console.warn('[ollama-gateway] kafka enqueue failed, falling back to sync path:', e?.message || e);
        }
      }

      let vec = null;
      try {
        vec = await embed(prompt);
      } catch (e) {
        console.warn('embed failed:', e?.message || e);
      }

      if (vec && redis) {
        const cached = await tryCache(vec);
        if (cached) {
          cacheHits.inc();
          latency.observe(Date.now() - start);
          if (stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            res.write(`data: ${JSON.stringify({ response: cached, cached: true })}\n\n`);
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ response: cached, cached: true }));
          return;
        }
      }

      const model = pickModel(prompt);

      if (stream) {
        const ollamaRes = await ollamaFetch('/api/generate', {
          method: 'POST',
          body: { model, prompt, stream: true },
        });
        if (!ollamaRes.ok || !ollamaRes.body) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `ollama ${ollamaRes.status}` }));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        let full = '';
        const reader = ollamaRes.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          full += chunk;
          res.write(`data: ${chunk}\n\n`);
        }
        if (vec) await storeCached(vec, full);
        latency.observe(Date.now() - start);
        res.end();
        return;
      }

      if (BATCH_ENABLE) {
        const result = await new Promise((resolve, reject) => {
          batchQueue.push({ prompt, resolve, reject });
          scheduleBatchFlush();
        });
        if (vec) await storeCached(vec, result);
        latency.observe(Date.now() - start);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: result, model }));
        return;
      }

      const r = await ollamaFetch('/api/generate', {
        method: 'POST',
        body: { model, prompt, stream: false },
      });
      const data = await r.json();
      if (vec) await storeCached(vec, data.response);
      latency.observe(Date.now() - start);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: data.response, model }));
    } catch (e) {
      console.error(e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e?.message || e) }));
      } else {
        res.destroy();
      }
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ollama-gateway listening on :${PORT} → ${OLLAMA}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
