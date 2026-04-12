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

const chrome = { ...devices["Desktop Chrome"] };

/**
 * Logical groups for reports and targeted runs (`pnpm exec playwright test --project=03-listings`).
 * Every *.spec.ts under e2e/ belongs to exactly one project so no test runs twice.
 */
const suiteProjects = [
  {
    name: "01-guest-shell",
    testMatch: ["guest.spec.ts", "webapp-pages.spec.ts", "messaging-mentioned.spec.ts"],
  },
  {
    name: "02-auth-booking",
    testMatch: ["auth-cycle.spec.ts", "flows.spec.ts"],
  },
  {
    name: "03-listings",
    testMatch: ["listing-and-analytics-journey.spec.ts", "listings-filters-maps.spec.ts"],
  },
  {
    name: "04-analytics",
    testMatch: ["analytics-api.spec.ts", "analytics-ui.spec.ts"],
  },
  {
    name: "05-optional-screenshots",
    testMatch: ["ui-screenshots.spec.ts"],
  },
  {
    name: "06-service-verticals",
    testMatch: [
      "**/*.full.spec.ts",
      "messaging.functional.spec.ts",
      "gateway.routing.spec.ts",
      "edge.failure-modes.spec.ts",
      "transport.protocol.spec.ts",
    ],
  },
  {
    name: "07-system-integrity",
    testMatch: ["system-integrity.spec.ts"],
  },
] as const;

export default defineConfig({
  globalSetup: "./playwright.global-setup.ts",
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 4,
  outputDir: "test-results",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      "x-e2e-test": "1",
      "x-test-mode": "1",
    },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: suiteProjects.map((p) => ({
    name: p.name,
    use: { ...chrome },
    testMatch: [...p.testMatch],
  })),
});