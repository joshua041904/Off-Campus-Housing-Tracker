import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

const DEFAULT_E2E_EDGE = "https://off-campus-housing.test";

function normalizeE2eApiBaseRaw(raw: string | undefined): string {
  if (!raw?.trim()) return DEFAULT_E2E_EDGE;
  const t = raw.trim();
  if (/127\.0\.0\.1:4020|localhost:4020/i.test(t)) return DEFAULT_E2E_EDGE;
  if (t.startsWith("http://")) return DEFAULT_E2E_EDGE;
  return t.replace(/\/$/, "");
}

/** Public edge URL for API checks (Caddy → HAProxy → gateway). No port-forward / :4020. */
export function e2eApiBase(): string {
  return normalizeE2eApiBaseRaw(process.env.E2E_API_BASE);
}

export async function apiGatewayHealthy(request: APIRequestContext): Promise<boolean> {
  const base = e2eApiBase();
  try {
    const r = await request.get(`${base}/api/healthz`, { timeout: 5_000 });
    return r.ok();
  } catch {
    return false;
  }
}

/**
 * Liveness-only /api/healthz is not enough for register (gRPC auth). /api/readyz stays 503 until
 * auth-service gRPC health succeeds on the gateway pod.
 */
export async function apiGatewayReady(request: APIRequestContext): Promise<boolean> {
  if (!(await apiGatewayHealthy(request))) return false;
  const base = e2eApiBase();
  try {
    const r = await request.get(`${base}/api/readyz`, { timeout: 10_000 });
    return r.ok();
  } catch {
    return false;
  }
}

/** First listing id from public search, or null (empty index / error). */
export async function firstListingIdFromSearch(request: APIRequestContext): Promise<string | null> {
  const base = e2eApiBase();
  try {
    const r = await request.get(`${base}/api/listings/search`, { timeout: 15_000 });
    if (!r.ok()) return null;
    const data = (await r.json()) as { items?: { id: string }[] };
    const id = data.items?.[0]?.id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export function uniqueE2eEmail(prefix: string, workerIndex: number): string {
  return `${prefix}-w${workerIndex}-${Date.now()}-${randomUUID().slice(0, 10)}@example.com`;
}

/** Gateway/auth occasionally returns 502 under parallel E2E load; treat as retryable. */
const TRANSIENT_REGISTER_UI_ERR =
  /50[234]|502|503|504|429|Bad Gateway|Gateway Timeout|temporar|unavailable|ECONNRESET|Failed to fetch|NetworkError|fetch failed/i;

/** Validation / conflict — retrying the same email will not help. */
const NON_RETRYABLE_REGISTER =
  /email\/password required|already exists|duplicate|409|unique constraint|invalid email|password too short/i;

async function waitForEdgeReadyz(page: Page, maxMs: number): Promise<void> {
  const base = e2eApiBase();
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const r = await page.request.get(`${base}/api/readyz`, { timeout: 8_000 });
      if (r.ok()) return;
    } catch {
      /* ignore */
    }
    await sleep(1_200);
  }
}

/**
 * Fill register form and assert we land on /dashboard, with actionable error if not.
 * Retries on transient edge/auth failures (502/503/504, empty error) — see E2E_REGISTER_RETRIES (default 5).
 * Waits for POST /api/auth/register and fails fast on 4xx validation (not load-related).
 */
export async function registerViaUi(page: Page, email: string, password: string): Promise<void> {
  const maxAttempts = Math.max(1, Number(process.env.E2E_REGISTER_RETRIES ?? "5") || 5);
  const responseTimeout = Math.max(5_000, Number(process.env.E2E_REGISTER_RESPONSE_MS ?? "30_000") || 30_000);
  const dashboardTimeout = Math.max(5_000, Number(process.env.E2E_DASHBOARD_MS ?? "45_000") || 45_000);
  let lastDetail = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await page.goto("/register", { waitUntil: "domcontentloaded" });

    const emailInput = page.locator("#email");
    const passwordInput = page.locator("#password");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await emailInput.blur();
    await passwordInput.blur();
    await expect(emailInput).toHaveValue(email);
    await expect(passwordInput).toHaveValue(password);

    const regRespP = page.waitForResponse(
      (r) => r.url().includes("/api/auth/register") && r.request().method() === "POST",
      { timeout: responseTimeout },
    );

    await page.locator('[data-testid="register-form"]').getByRole("button", { name: "Create account" }).click();

    let regStatus = 0;
    let regBody = "";
    try {
      const reg = await regRespP;
      regStatus = reg.status();
      regBody = (await reg.text().catch(() => "")).slice(0, 500);
    } catch {
      regStatus = 0;
    }

    if (regStatus === 0) {
      lastDetail = "no POST /api/auth/register response (timeout or navigation error)";
      if (attempt < maxAttempts) {
        const backoff = Math.min(1_500 * 2 ** (attempt - 1), 12_000);
        await sleep(backoff);
        await waitForEdgeReadyz(page, 20_000);
        continue;
      }
      throw new Error(
        `Register did not get API response (${lastDetail}). url=${page.url()} attempts=${attempt}/${maxAttempts}.`,
      );
    }

    if (regStatus === 400 || regStatus === 409) {
      throw new Error(
        `Register API ${regStatus} (not retryable): ${regBody || "empty body"}. ` +
          `url=${page.url()} email=${email.slice(0, 24)}… — check gateway json body parse and auth gRPC.`,
      );
    }

    if (regStatus !== 201 && regStatus !== 200) {
      if (regStatus >= 500 || regStatus === 429) {
        lastDetail = `register HTTP ${regStatus}: ${regBody}`;
        if (attempt < maxAttempts) {
          const backoff = Math.min(1_500 * 2 ** (attempt - 1), 12_000);
          await sleep(backoff);
          await waitForEdgeReadyz(page, 20_000);
          continue;
        }
        throw new Error(
          `Register did not reach /dashboard after ${maxAttempts} attempts. Last: ${lastDetail}`,
        );
      }
      throw new Error(
        `Register API unexpected ${regStatus}: ${regBody}. url=${page.url()}`,
      );
    }

    const dashP = page.waitForURL(/\/dashboard$/, { timeout: dashboardTimeout });
    const errP = page.locator('[data-testid="register-error"]').waitFor({ state: "visible", timeout: dashboardTimeout });
    void dashP.catch(() => {});
    void errP.catch(() => {});
    try {
      await Promise.race([dashP, errP]);
    } catch {
      /* both timed out or navigation error */
    }

    if (/\/dashboard$/.test(page.url())) {
      await page.waitForSelector('[data-testid="dashboard-root"]', { timeout: 20_000 });
      return;
    }

    const inline = await page.locator('[data-testid="register-error"]').first().textContent().catch(() => null);
    lastDetail = inline?.trim() || "No inline error (register timed out)";

    if (NON_RETRYABLE_REGISTER.test(lastDetail)) {
      throw new Error(
        `Register did not reach /dashboard (url=${page.url()}, attempts=${attempt}/${maxAttempts}). ` +
          `Form error: ${lastDetail}. ` +
          "This is a validation or data issue, not a transient edge error.",
      );
    }

    const retryable =
      TRANSIENT_REGISTER_UI_ERR.test(lastDetail) ||
      (/No inline error/.test(lastDetail) && attempt < maxAttempts);

    if (retryable && attempt < maxAttempts) {
      const backoff = Math.min(1_500 * 2 ** (attempt - 1), 12_000);
      await sleep(backoff);
      await waitForEdgeReadyz(page, 20_000);
      continue;
    }

    throw new Error(
      `Register did not reach /dashboard (url=${page.url()}, attempts=${attempt}/${maxAttempts}). ` +
        `Form error: ${lastDetail}. ` +
        "Ensure /api/readyz is 200 on the edge (auth gRPC), E2E_API_BASE is https and resolves (e.g. /etc/hosts → MetalLB), and trust dev-root for TLS.",
    );
  }
}
