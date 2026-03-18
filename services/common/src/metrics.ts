import client from 'prom-client'
export const register = new client.Registry()
client.collectDefaultMetrics({ register })
export const httpCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP requests',
  labelNames: ['service','route','method','code']
})
register.registerMetric(httpCounter)
