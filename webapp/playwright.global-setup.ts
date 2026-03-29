import * as fs from "node:fs";
import * as https from "node:https";

/**
 * When PLAYWRIGHT_VERTICAL_STRICT=1, fail fast if the edge is not reachable.
 * Use on runners that have E2E_API_BASE (e.g. MetalLB /etc/hosts) and NODE_EXTRA_CA_CERTS.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.PLAYWRIGHT_VERTICAL_STRICT !== "1") {
    return;
  }

  const raw = process.env.E2E_API_BASE?.trim() || "https://off-campus-housing.test";
  const base = raw.replace(/\/$/, "");
  const caPath = process.env.NODE_EXTRA_CA_CERTS?.trim();
  if (!caPath || !fs.existsSync(caPath)) {
    throw new Error(
      "PLAYWRIGHT_VERTICAL_STRICT=1 requires NODE_EXTRA_CA_CERTS pointing to an existing CA file",
    );
  }
  const ca = fs.readFileSync(caPath);

  const url = new URL(`${base}/api/healthz`);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (url.protocol !== "https:") {
    throw new Error(`PLAYWRIGHT_VERTICAL_STRICT requires https E2E_API_BASE, got ${url.protocol}`);
  }

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port,
        path: url.pathname || "/",
        method: "GET",
        ca,
        servername: url.hostname,
        timeout: 15_000,
      },
      (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`edge /api/healthz returned ${res.statusCode}`));
        }
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("edge /api/healthz TLS request timed out"));
    });
    req.end();
  });
}
