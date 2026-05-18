import path from "node:path";
import { fileURLToPath } from "node:url";
import { coverageExcludeForHousingService } from "../../infra/vitest-coverage-pragmatic-excludes";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  test: {
    environment: "node",
    /** Deterministic module mocks for ../src/server (api-gateway.exhaustive must win cache over gateway-http). */
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "tests/auto/**"],
    env: {
      /** No Docker/K8s DNS for `redis` during Vitest — avoids OTEL dns.lookup ENOTFOUND noise. */
      OCH_DISABLE_EXTERNALS: "1",
      /** Route-hit JSONL for matrix: suite=vitest via `vitestRouteHitAgent` in tests. */
      GATEWAY_ROUTE_COVERAGE_LOG: "1",
      GATEWAY_ROUTE_COVERAGE_FILE: path.join(repoRoot, "bench_logs", "routes-hit.jsonl"),
      GATEWAY_SKIP_AUTH_UPSTREAM_VERIFY: "1",
      /** CA-only gRPC channel for Vitest (createSsl(root) in @common/utils grpc-clients). */
      GRPC_CA_CERT: path.join(repoRoot, "certs", "dev-root.pem"),
      /** Refused-port upstreams: proxy routes fail fast without K8s DNS (exhaustive HTTP tests). */
      AUTH_HTTP: "http://127.0.0.1:1",
      LISTINGS_HTTP: "http://127.0.0.1:1",
      BOOKING_HTTP: "http://127.0.0.1:1",
      MESSAGING_HTTP: "http://127.0.0.1:1",
      TRUST_HTTP: "http://127.0.0.1:1",
      ANALYTICS_HTTP: "http://127.0.0.1:1",
      MEDIA_HTTP: "http://127.0.0.1:1",
      NOTIFICATION_HTTP: "http://127.0.0.1:1",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "json-summary"],
      reportsDirectory: "./coverage",
      /** Per-service ≥98% is enforced by repo `pnpm run coverage:enforce-98` (not Vitest duplicate thresholds). */
      exclude: [
        ...coverageExcludeForHousingService("api-gateway"),
        "tests/**/*.integration.test.ts",
      ],
    },
  },
});
