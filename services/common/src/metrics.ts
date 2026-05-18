import client, { type OpenMetricsContentType } from "prom-client";

/** OpenMetrics so Histograms may attach trace_id exemplars (Prometheus 2.26+ scrape + exemplar storage). */
export const register = new client.Registry<OpenMetricsContentType>();
register.setContentType(client.Registry.OPENMETRICS_CONTENT_TYPE);
client.collectDefaultMetrics({ register });
export const httpCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP requests',
  labelNames: ['service','route','method','code','proto']
})
register.registerMetric(httpCounter)

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['service', 'route', 'method', 'code', 'proto'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
})
register.registerMetric(httpRequestDurationSeconds)
