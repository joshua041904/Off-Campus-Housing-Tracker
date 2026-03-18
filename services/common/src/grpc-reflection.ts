/* cspell:ignore grpc */
/**
 * gRPC Reflection Support
 * 
 * Enables gRPC reflection for services so tools like grpcurl can discover
 * service methods without requiring proto files.
 */

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { ReflectionService } from "@grpc/reflection";
import * as fs from "fs";

/**
 * Enable reflection for a gRPC server
 * 
 * @param server - The gRPC server instance
 * @param protoPaths - Array of proto file paths to load for reflection
 * @param serviceNames - Array of service names to expose (e.g., ["records.RecordsService"])
 */
export function enableReflection(
  server: grpc.Server,
  protoPaths: string[],
  serviceNames: string[]
): void {
  try {
    console.log(`[reflection] Enabling reflection for services: ${serviceNames.join(", ")}`);
    
    // Load proto files and create package definitions
    // We need to merge all proto definitions into a single package definition
    const allDefinitions: any = {};
    for (const protoPath of protoPaths) {
      if (fs.existsSync(protoPath)) {
        const def = protoLoader.loadSync(protoPath, {
          keepCase: true,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true,
        });
        // Merge definitions (proto-loader returns an object with package/service structure)
        Object.assign(allDefinitions, def);
      } else {
        console.warn(`[reflection] Proto file not found: ${protoPath}`);
      }
    }

    if (Object.keys(allDefinitions).length === 0) {
      console.warn("[reflection] No proto files found, reflection disabled");
      return;
    }

    // Create ReflectionService instance and add it to the server
    const reflection = new ReflectionService(allDefinitions);
    reflection.addToServer(server);
    console.log(`[reflection] Reflection enabled successfully for ${serviceNames.length} service(s)`);
  } catch (error) {
    console.error("[reflection] Failed to enable reflection:", error);
  }
}

