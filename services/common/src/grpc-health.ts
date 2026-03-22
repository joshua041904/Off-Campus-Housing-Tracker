/**
 * Standard gRPC Health Checking Protocol implementation
 * Based on grpc.health.v1.Health from health.proto
 * 
 * Supports HTTP/2 (h2), HTTP/2 cleartext (h2c), and HTTP/3 (QUIC)
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import * as fs from 'fs';
import { resolveProtoPath } from './proto.js';

// Health check status tracking
export interface ServiceHealthStatus {
  [serviceName: string]: number; // ServingStatus enum value
}

// ServingStatus enum values (from health.proto)
export enum ServingStatus {
  UNKNOWN = 0,
  SERVING = 1,
  NOT_SERVING = 2,
  SERVICE_UNKNOWN = 3,
}

// Load health.proto
function loadHealthProto() {
  try {
    const HEALTH_PROTO_PATH = resolveProtoPath('health.proto');
    if (fs.existsSync(HEALTH_PROTO_PATH)) {
      const packageDefinition = protoLoader.loadSync(HEALTH_PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
      return grpc.loadPackageDefinition(packageDefinition);
    }
  } catch (err) {
    console.warn('[grpc-health] Failed to load health.proto:', err);
  }
  return null;
}

const healthProto = loadHealthProto();

/**
 * Standard gRPC Health Service implementation
 * Implements grpc.health.v1.Health.Check and Watch methods
 */
export class HealthService {
  private statusMap: ServiceHealthStatus = {};
  private healthCheckFunction?: () => Promise<boolean>;
  /** Names K8s grpc-health-probe may pass via -service= (plus '' = overall). */
  private readonly probeServiceNames: Set<string>;

  constructor(
    primaryProbeServiceName: string,
    healthCheckFn?: () => Promise<boolean>,
    additionalProbeServiceNames: readonly string[] = []
  ) {
    this.healthCheckFunction = healthCheckFn;
    this.probeServiceNames = new Set<string>(['', primaryProbeServiceName, ...additionalProbeServiceNames]);
    // Explicit canonical pattern: register overall + each FQ service name as SERVING until first Check runs.
    for (const name of this.probeServiceNames) {
      this.statusMap[name] = ServingStatus.SERVING;
    }
  }

  private _applyHealthStatusToAllRegistered(status: ServingStatus) {
    for (const name of this.probeServiceNames) {
      this.statusMap[name] = status;
    }
  }

  /**
   * Check health status for a service
   * Implements grpc.health.v1.Health.Check
   */
  async Check(call: any, callback: any) {
    const service = call.request?.service ?? '';

    if (service !== '' && !this.probeServiceNames.has(service)) {
      callback(null, { status: ServingStatus.SERVICE_UNKNOWN });
      return;
    }

    if (this.healthCheckFunction) {
      try {
        const isHealthy = await this.healthCheckFunction();
        const status = isHealthy ? ServingStatus.SERVING : ServingStatus.NOT_SERVING;
        this._applyHealthStatusToAllRegistered(status);
        callback(null, { status });
        return;
      } catch (err: any) {
        console.error('[grpc-health] Health check failed:', err);
        this._applyHealthStatusToAllRegistered(ServingStatus.NOT_SERVING);
        callback(null, { status: ServingStatus.NOT_SERVING });
        return;
      }
    }

    const status = this.statusMap[service] ?? ServingStatus.SERVICE_UNKNOWN;
    callback(null, { status });
  }

  /**
   * Watch health status for a service (streaming)
   * Implements grpc.health.v1.Health.Watch
   */
  async Watch(call: any) {
    const service = call.request?.service ?? '';
    if (service !== '' && !this.probeServiceNames.has(service)) {
      call.write({ status: ServingStatus.SERVICE_UNKNOWN });
      call.end?.();
      return;
    }
    const interval = setInterval(async () => {
      try {
        let status: number;

        if (this.healthCheckFunction) {
          const isHealthy = await this.healthCheckFunction();
          status = isHealthy ? ServingStatus.SERVING : ServingStatus.NOT_SERVING;
          this._applyHealthStatusToAllRegistered(status as ServingStatus);
        } else {
          status = this.statusMap[service] ?? ServingStatus.SERVICE_UNKNOWN;
        }

        call.write({ status });
      } catch (err) {
        call.write({ status: ServingStatus.NOT_SERVING });
      }
    }, 5000); // Check every 5 seconds

    call.on('end', () => {
      clearInterval(interval);
    });
  }

  /**
   * Update health status manually
   */
  setStatus(service: string, status: number) {
    this.statusMap[service] = status;
  }

  /**
   * Get current status
   */
  getStatus(service: string = ''): number {
    return this.statusMap[service] || ServingStatus.SERVICE_UNKNOWN;
  }
}

/**
 * Register standard gRPC Health Service on a server (strict per-service names for K8s mTLS probes).
 *
 * @param primaryProbeServiceName - Must match K8s readiness `grpc-health-probe -service=` (e.g. analytics.AnalyticsService)
 * @param healthCheckFn - Optional; when set, SERVING/NOT_SERVING applies to all registered names + overall ('').
 * @param additionalProbeServiceNames - Other FQ service names on the same server (e.g. RecommendationAdminService).
 */
export function registerHealthService(
  server: grpc.Server,
  primaryProbeServiceName: string,
  healthCheckFn?: () => Promise<boolean>,
  additionalProbeServiceNames?: readonly string[]
): HealthService | null {
  if (!healthProto) {
    console.warn('[grpc-health] health.proto not loaded, standard health service unavailable');
    return null;
  }

  // Type assertion for proto structure
  const protoAny = healthProto as any;
  if (!protoAny.grpc?.health?.v1?.Health) {
    console.warn('[grpc-health] health.proto structure not found, standard health service unavailable');
    return null;
  }

  const healthService = new HealthService(
    primaryProbeServiceName,
    healthCheckFn,
    additionalProbeServiceNames ?? []
  );
  const healthServiceDefinition = protoAny.grpc.health.v1.Health.service;

  server.addService(healthServiceDefinition, {
    Check: healthService.Check.bind(healthService),
    Watch: healthService.Watch.bind(healthService),
  });

  const allNames = ['', primaryProbeServiceName, ...(additionalProbeServiceNames ?? [])].filter(
    (n, i, a) => a.indexOf(n) === i
  );
  console.log(
    `[grpc-health] Health Check registered for probe names: ${allNames.map((n) => (n === '' ? '(overall)' : n)).join(', ')}`
  );
  return healthService;
}

// Type definitions are handled via the ServingStatus enum above

