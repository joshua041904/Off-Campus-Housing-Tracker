import { defineConfig, devices } from "@playwright/test";

const DEFAULT_E2E = "https://off-campus-housing.test";

function stripTrailingSlash(u: string): string {
  return u.replace(/\/$/, "");
}

/**
 * Edge-only E2E: same URL the browser uses for pages and API (Caddy → HAProxy → gateway).
 * Rejects legacy port-forward env (http://127.0.0.1:4020, etc.).
 */
function normalizeE2eApiBase(): string {
  const raw = process.env.E2E_API_BASE?.trim();
  if (!raw) return DEFAULT_E2E;
  if (/127\.0\.0\.1:4020|localhost:4020/i.test(raw)) return DEFAULT_E2E;
  if (raw.startsWith("http://")) return DEFAULT_E2E;
  return stripTrailingSlash(raw);
}

const baseURL = normalizeE2eApiBase();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    // Browser E2E runs against local dev certs; app behavior is under test, not certificate validation.
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      "x-e2e-test": "1",
    },
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
