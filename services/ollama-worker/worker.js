/**
 * Consumes ollama-jobs from Kafka, runs Ollama /api/generate, stores JSON result in Redis job:{id},
 * and emits Prometheus metrics on /metrics.
 */
import fs from 'fs';
import http from 'http';
import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

const REDIS_URL = (process.env.REDIS_URL || 'redis://host.docker.internal:6380/0').trim();
const OLLAMA = (process.env.OLLAMA_URL || 'http://ollama:11434').replace(/\/$/, '');
const KAFKA_BROKERS = (
  process.env.KAFKA_BROKERS ||
  'kafka-0.kafka:9093,kafka-1.kafka:9093,kafka-2.kafka:9093,kafka-0.kafka-headless:9093,kafka-1.kafka-headless:9093,kafka-2.kafka-headless:9093'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const TOPIC = process.env.OLLAMA_JOBS_TOPIC || 'ollama-jobs';
const DLQ_TOPIC = process.env.OLLAMA_DLQ_TOPIC || 'ollama-jobs-dlq';
const GROUP = process.env.OLLAMA_WORKER_GROUP || 'ollama-worker-group';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3:8b';
const TOPIC_PARTITIONS = parseInt(process.env.OLLAMA_JOBS_TOPIC_PARTITIONS || '6', 10) || 6;
const DLQ_PARTITIONS = parseInt(process.env.OLLAMA_DLQ_TOPIC_PARTITIONS || '3', 10) || 3;
const MAX_JOB_RETRIES = parseInt(process.env.OLLAMA_WORKER_MAX_RETRIES || '5', 10) || 5;
const METRICS_PORT = parseInt(process.env.OLLAMA_WORKER_METRICS_PORT || '9100', 10) || 9100;

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
      console.warn('[ollama-worker] kafka TLS file read failed, using ssl:true', e?.message || e);
    }
  }
  return process.env.KAFKA_SSL_ENABLED !== 'false';
}

const registry = new Registry();
const jobsProcessed = new Counter({
  name: 'ollama_worker_jobs_processed_total',
  help: 'Total jobs successfully processed',
  registers: [registry],
});
const jobsFailed = new Counter({
  name: 'ollama_worker_jobs_failed_total',
  help: 'Total jobs that failed processing',
  registers: [registry],
});
const jobsDlq = new Counter({
  name: 'ollama_worker_jobs_dlq_total',
  help: 'Total jobs sent to dead-letter queue',
  registers: [registry],
});
const jobLatency = new Histogram({
  name: 'ollama_worker_job_latency_ms',
  help: 'Job processing latency in ms',
  buckets: [50, 100, 200, 500, 1000, 2000, 5000, 10000],
  registers: [registry],
});
/** 1 if the last admin metadata probe succeeded (periodic; see OLLAMA_WORKER_KAFKA_PROBE_INTERVAL_MS). */
const kafkaBrokerReachable = new Gauge({
  name: 'ollama_worker_kafka_broker_reachable',
  help: '1 if Kafka admin connect+disconnect succeeded on last probe, else 0',
  registers: [registry],
});

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
redis.on('error', (err) => {
  console.warn('[ollama-worker] redis:', err?.message || err);
});
const kafka = new Kafka({
  clientId: `ollama-worker-${process.env.HOSTNAME || '0'}`,
  brokers: KAFKA_BROKERS,
  ssl: loadKafkaJsSslOption(),
  connectionTimeout: Number(process.env.KAFKAJS_CONNECTION_TIMEOUT_MS || '4000'),
  retry: {
    initialRetryTime: 300,
    retries: 10,
  },
});
const consumer = kafka.consumer({ groupId: GROUP });
const producer = kafka.producer();
const admin = kafka.admin();

let metricsServerStarted = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const KAFKA_PROBE_MS = parseInt(process.env.OLLAMA_WORKER_KAFKA_PROBE_INTERVAL_MS || '15000', 10) || 15000;

async function probeKafkaBrokerReachable() {
  const adm = kafka.admin();
  try {
    await adm.connect();
    await adm.disconnect();
    kafkaBrokerReachable.set(1);
  } catch {
    kafkaBrokerReachable.set(0);
    try {
      await adm.disconnect();
    } catch {
      /* ignore */
    }
  }
}

function startPeriodicKafkaProbe() {
  void probeKafkaBrokerReachable();
  setInterval(() => void probeKafkaBrokerReachable(), KAFKA_PROBE_MS);
}

function startMetricsServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/metrics' || req.url?.startsWith('/metrics?'))) {
      res.writeHead(200, { 'Content-Type': registry.contentType });
      res.end(await registry.metrics());
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(METRICS_PORT, '0.0.0.0', () => {
    console.log(`ollama-worker metrics listening on :${METRICS_PORT}`);
  });
}

async function ensureTopics() {
  try {
    await admin.connect();
    const existing = await admin.listTopics();
    const wanted = [
      { topic: TOPIC, numPartitions: TOPIC_PARTITIONS, replicationFactor: 1 },
      { topic: DLQ_TOPIC, numPartitions: DLQ_PARTITIONS, replicationFactor: 1 },
    ];
    const missing = wanted.filter((t) => !existing.includes(t.topic));
    if (missing.length) {
      await admin.createTopics({ topics: missing, waitForLeaders: true });
      console.log('created missing topics:', missing.map((t) => t.topic).join(','));
    }
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

async function runGenerate(model, prompt) {
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  const data = await r.json();
  if (typeof data.response !== 'string') throw new Error('ollama missing response');
  return data.response;
}

async function retryWithBackoff(fn, retries = MAX_JOB_RETRIES) {
  let delay = 500;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new Error('retry exhausted');
}

async function sendDlq(payload) {
  await producer.send({
    topic: DLQ_TOPIC,
    messages: [{ value: JSON.stringify(payload) }],
  });
}

async function main() {
  if (!metricsServerStarted) {
    startMetricsServer();
    startPeriodicKafkaProbe();
    metricsServerStarted = true;
  }
  await producer.connect();
  await ensureTopics();
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const start = Date.now();
      let jobId;
      try {
        const payload = JSON.parse(message.value?.toString() || '{}');
        jobId = payload.jobId || payload.id;
        const prompt = payload.prompt;
        const model = payload.model || DEFAULT_MODEL;
        if (!jobId || !prompt) return;

        const response = await retryWithBackoff(() => runGenerate(model, prompt));
        await redis.set(`job:${jobId}`, JSON.stringify({ response, model }), 'EX', 3600);
        jobsProcessed.inc();
        jobLatency.observe(Date.now() - start);
      } catch (e) {
        jobsFailed.inc();
        console.error('job failed', jobId, e?.message || e);
        if (jobId) {
          await redis
            .set(`job:${jobId}`, JSON.stringify({ error: String(e?.message || e) }), 'EX', 600)
            .catch(() => {});
        }
        await sendDlq({
          jobId: jobId || null,
          error: String(e?.message || e),
          payload: message.value?.toString() || '',
          ts: new Date().toISOString(),
        }).catch((err) => {
          console.error('dlq send failed', err?.message || err);
        });
        jobsDlq.inc();
      }
    },
  });
}

function scheduleWorkerRestart(err) {
  console.error('ollama-worker error, retrying in 5s', err?.message || err);
  void Promise.allSettled([consumer.disconnect(), producer.disconnect()]).finally(() => {
    setTimeout(() => {
      void main().catch(scheduleWorkerRestart);
    }, 5000);
  });
}

void main().catch(scheduleWorkerRestart);
