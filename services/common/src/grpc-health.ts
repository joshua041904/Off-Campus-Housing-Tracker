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

  constructor(serviceName: string, healthCheckFn?: () => Promise<boolean>) {
    this.healthCheckFunction = healthCheckFn;
    // Set default status for service
    this.statusMap[serviceName] = ServingStatus.SERVING;
    // Empty string = overall service health
    this.statusMap[''] = ServingStatus.SERVING;
  }

  /**
   * Check health status for a service
   * Implements grpc.health.v1.Health.Check
   */
  async Check(call: any, callback: any) {
    const service = call.request.service || '';
    
    // If health check function provided, use it to determine health
    if (this.healthCheckFunction) {
      try {
        const isHealthy = await this.healthCheckFunction();
        const status = isHealthy ? ServingStatus.SERVING : ServingStatus.NOT_SERVING;
        
        // Update status map
        this.statusMap[service] = status;
        this.statusMap[''] = status; // Overall service health
        
        callback(null, { status });
        return;
      } catch (err: any) {
        console.error('[grpc-health] Health check failed:', err);
        this.statusMap[service] = ServingStatus.NOT_SERVING;
        this.statusMap[''] = ServingStatus.NOT_SERVING;
        callback(null, { status: ServingStatus.NOT_SERVING });
        return;
      }
    }
    
    // Use cached status if available
    const status = this.statusMap[service] || ServingStatus.SERVICE_UNKNOWN;
    
    callback(null, { status });
  }

  /**
   * Watch health status for a service (streaming)
   * Implements grpc.health.v1.Health.Watch
   */
  async Watch(call: any) {
    const service = call.request.service || '';
    const interval = setInterval(async () => {
      try {
        let status: number;
        
        if (this.healthCheckFunction) {
          const isHealthy = await this.healthCheckFunction();
          status = isHealthy ? ServingStatus.SERVING : ServingStatus.NOT_SERVING;
        } else {
          status = this.statusMap[service] || ServingStatus.SERVICE_UNKNOWN;
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
 * Register standard gRPC Health Service on a server
 * @param server - gRPC server instance
 * @param serviceName - Name of the service (e.g., 'auth.AuthService', 'social.SocialService')
 * @param healthCheckFn - Optional function to check health (should return Promise<boolean>)
 */
export function registerHealthService(
  server: grpc.Server,
  serviceName: string,
  healthCheckFn?: () => Promise<boolean>
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

  const healthService = new HealthService(serviceName, healthCheckFn);
  const healthServiceDefinition = protoAny.grpc.health.v1.Health.service;

  server.addService(healthServiceDefinition, {
    Check: healthService.Check.bind(healthService),
    Watch: healthService.Watch.bind(healthService),
  });

  console.log(`[grpc-health] Standard gRPC Health Service registered for ${serviceName}`);
  return healthService;
}

// Type definitions are handled via the ServingStatus enum above

