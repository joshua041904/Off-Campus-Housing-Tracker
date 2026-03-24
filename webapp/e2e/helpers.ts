import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";

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

/** Fill register form and assert we land on /dashboard, with actionable error if not. */
export async function registerViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.locator('[data-testid="register-form"]').getByRole("button", { name: "Register" }).click();
  try {
    await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
  } catch {
    const inline = await page.locator('[data-testid="register-error"]').first().textContent().catch(() => null);
    throw new Error(
      `Register did not reach /dashboard (url=${page.url()}). ` +
        (inline ? `Form error: ${inline}` : "No inline error") +
        ". Ensure /api/readyz is 200 on the edge (auth gRPC), E2E_API_BASE is https and resolves (e.g. /etc/hosts → MetalLB), and trust dev-root for TLS."
    );
  }
}
