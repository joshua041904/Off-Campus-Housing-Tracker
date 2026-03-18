import * as fs from "fs";
import * as path from "path";

const DEFAULT_PROTO_DIRS = [
  process.env.PROTO_ROOT,
  // /app/services/<pkg>/dist -> ../../../proto === /app/proto when running in containers
  path.resolve(__dirname, "../../../proto"),
  // Helpful during local development when running from repo root
  path.resolve(process.cwd(), "proto"),
  // /app/services/<pkg>/dist -> ../../proto === /app/services/proto if copied nearby
  path.resolve(__dirname, "../../proto"),
];

export function resolveProtoPath(fileName: string): string {
  const tried: string[] = [];
  for (const candidateRoot of DEFAULT_PROTO_DIRS) {
    if (!candidateRoot) continue;
    const candidate = path.resolve(candidateRoot, fileName);
    tried.push(candidate);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Unable to locate proto file "${fileName}". Tried: ${tried.join(", ")}`
  );
}

