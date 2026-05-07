import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath } from "./vertical-helpers";

test.describe("gateway routing", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("GET /api/healthz", async ({ request }) => {
    const r = await request.get(edgePath("/api/healthz"));
    expect(r.ok(), await r.text()).toBeTruthy();
  });

  test("GET /api/readyz returns status", async ({ request }) => {
    const r = await request.get(edgePath("/api/readyz"));
    expect(r.status()).toBeGreaterThanOrEqual(200);
    expect(r.status()).toBeLessThan(600);
  });

  test("unknown /api/gateway-test-missing-route → 404", async ({ request }) => {
    const r = await request.get(edgePath("/api/gateway-test-missing-route-404"));
    expect(r.status()).toBe(404);
  });

  test("GET /api/listings with browser fetch headers is not blocked by x-suite policy", async ({ request }) => {
    const r = await request.get(edgePath("/api/listings?limit=1"), {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    const text = await r.text();
    expect(text, `unexpected suite policy block: ${r.status()} ${text.slice(0, 240)}`).not.toMatch(/Missing x-suite header/i);
  });
});
