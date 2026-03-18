"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpCounter = exports.register = void 0;
const prom_client_1 = __importDefault(require("prom-client"));
exports.register = new prom_client_1.default.Registry();
prom_client_1.default.collectDefaultMetrics({ register: exports.register });
exports.httpCounter = new prom_client_1.default.Counter({
    name: 'http_requests_total',
    help: 'HTTP requests',
    labelNames: ['service', 'route', 'method', 'code']
});
exports.register.registerMetric(exports.httpCounter);
