import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "@playwright/test";

const SCREENSHOT_DIR = path.join(process.cwd(), "e2e", "screenshots");
const EDGE_BASE = process.env.OBS_SCREENSHOT_BASE_URL || "https://off-campus-housing.test";
const K6_SUMMARY_TXT = path.join(process.cwd(), "..", "bench_logs", "k6-booking-spike-tier5-quick", "summary.txt");

test.describe("Observability screenshots (optional)", () => {
  test("capture Jaeger, AI composite, and spike metrics", async ({ page }) => {
    test.skip(process.env.E2E_SCREENSHOTS !== "1", "set E2E_SCREENSHOTS=1 to write PNGs to e2e/screenshots/");
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const shot = async (name: string) => {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
    };

    await page.goto(`${EDGE_BASE.replace(/\/+$/, "")}/jaeger`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await shot("08-jaeger-trace");

    await page.goto(`${EDGE_BASE.replace(/\/+$/, "")}/grafana`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await shot("09-ai-composite-graph");

    const summary = fs.existsSync(K6_SUMMARY_TXT)
      ? fs.readFileSync(K6_SUMMARY_TXT, "utf8")
      : "k6 summary file not found. Run scripts/load/run-booking-spike-tier5.sh first.";
    await page.setContent(`<pre style="font: 12px/1.4 monospace; white-space: pre-wrap;">${summary.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c))}</pre>`);
    await shot("10-k6-spike-metrics");
  });
});
