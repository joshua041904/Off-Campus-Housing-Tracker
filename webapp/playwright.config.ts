import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.WEBAPP_E2E_PORT || "3100");
const gateway = process.env.E2E_API_BASE || process.env.API_GATEWAY_INTERNAL || "http://127.0.0.1:4020";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev -p ${webPort}`,
    url: `http://127.0.0.1:${webPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      API_GATEWAY_INTERNAL: gateway,
    },
  },
});
