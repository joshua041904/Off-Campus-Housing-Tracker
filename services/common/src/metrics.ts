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
