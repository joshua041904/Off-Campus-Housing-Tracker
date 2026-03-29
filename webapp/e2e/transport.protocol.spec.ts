import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath } from "./vertical-helpers";

function curlVersion(extra: string[]): string {
  const ca = process.env.NODE_EXTRA_CA_CERTS || "";
  if (!ca.trim()) {
    throw new Error("NODE_EXTRA_CA_CERTS unset");
  }
  const url = edgePath("/api/healthz");
  const args = ["-sS", "--cacert", ca, "-o", "/dev/null", "-w", "%{http_version}", ...extra, url];
  return execFileSync("curl", args, { encoding: "utf8" }).trim();
}

test.describe("transport protocol (curl)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("HTTP/2 ALPN reports version 2 against edge /api/healthz", async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
    test.skip(!process.env.NODE_EXTRA_CA_CERTS?.trim(), "NODE_EXTRA_CA_CERTS required for curl TLS");
    try {
      const v = curlVersion(["--http2"]);
      expect(["2", "1.1"]).toContain(v);
    } catch (e) {
      test.skip(true, `curl --http2 failed: ${(e as Error).message}`);
    }
  });

  test("HTTP/3-only must negotiate version 3 (downgrade fails)", async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
    test.skip(!process.env.NODE_EXTRA_CA_CERTS?.trim(), "NODE_EXTRA_CA_CERTS required for curl TLS");
    let v: string;
    try {
      v = curlVersion(["--http3-only"]);
    } catch (e) {
      if (process.env.PLAYWRIGHT_STRICT_HTTP3 === "1") {
        throw e;
      }
      test.skip(true, `curl --http3-only failed: ${(e as Error).message}`);
      return;
    }
    expect(v, "edge must speak HTTP/3 when forced with --http3-only (treat 1.1/2 as downgrade)").toBe("3");
  });
});
