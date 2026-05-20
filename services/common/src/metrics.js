"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpRequestDurationSeconds = exports.httpCounter = exports.register = void 0;
const prom_client_1 = __importDefault(require("prom-client"));
exports.register = new prom_client_1.default.Registry();
exports.register.setContentType(prom_client_1.default.Registry.OPENMETRICS_CONTENT_TYPE);
prom_client_1.default.collectDefaultMetrics({ register: exports.register });
exports.httpCounter = new prom_client_1.default.Counter({
    name: 'http_requests_total',
    help: 'HTTP requests',
    labelNames: ['service', 'route', 'method', 'code', 'proto']
});
exports.register.registerMetric(exports.httpCounter);
exports.httpRequestDurationSeconds = new prom_client_1.default.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['service', 'route', 'method', 'code', 'proto'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});
exports.register.registerMetric(exports.httpRequestDurationSeconds);
