import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath, invalidJwt } from "./vertical-helpers";

test.describe("listings (gateway vertical)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("GET /api/listings/healthz", async ({ request }) => {
    let lastBody = "";
    await expect
      .poll(
        async () => {
          const r = await request.get(edgePath("/api/listings/healthz"));
          lastBody = await r.text();
          return r.ok();
        },
        { timeout: 10_000, intervals: [1_000] },
      )
      .toBeTruthy();
    expect(lastBody).toBeTruthy();
  });

  test("GET /api/listings/search (public)", async ({ request }) => {
    const r = await request.get(edgePath("/api/listings/search"));
    expect(r.ok(), await r.text()).toBeTruthy();
  });

  test("POST /api/listings/create without auth → 401", async ({ request }) => {
    const r = await request.post(edgePath("/api/listings/create"), {
      data: { title: "e2e", description: "x", price_cents: 1 },
      headers: { "Content-Type": "application/json" },
    });
    expect(r.status()).toBe(401);
  });

  test("POST /api/listings/create with invalid JWT → 401", async ({
    request,
  }) => {
    const r = await request.post(edgePath("/api/listings/create"), {
      data: { title: "e2e", description: "x", price_cents: 1 },
      headers: {
        "Content-Type": "application/json",
        Authorization: invalidJwt,
      },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("GET /api/listings/listings/bad-id-format → 400", async ({
    request,
  }) => {
    const r = await request.get(edgePath("/api/listings/listings/not-a-uuid"));
    expect(r.status()).toBe(400);
  });

  test("GET /api/listings/listings/:id for missing valid uuid → 404", async ({
    request,
  }) => {
    const missingId = "11111111-1111-4111-8111-111111111111";
    const r = await request.get(
      edgePath(`/api/listings/listings/${missingId}`),
    );
    expect(r.status()).toBe(404);
  });
});
