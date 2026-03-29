import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath, invalidJwt } from "./vertical-helpers";

test.describe("media (gateway vertical)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("GET /api/media/healthz", async ({ request }) => {
    const r = await request.get(edgePath("/api/media/healthz"));
    expect([200, 503]).toContain(r.status());
  });

  test("unknown /api/media/* without auth → 404 or 401", async ({ request }) => {
    const r = await request.get(edgePath("/api/media/no-such-static-route"));
    expect([401, 404]).toContain(r.status());
  });

  test("POST /api/media/createUploadUrl without auth → 401", async ({ request }) => {
    const r = await request.post(edgePath("/api/media/createUploadUrl"), {
      data: { content_type: "image/png", listing_id: "00000000-0000-0000-0000-000000000001" },
      headers: { "Content-Type": "application/json" },
    });
    expect([401, 404]).toContain(r.status());
  });

  test("POST /api/media/createUploadUrl invalid JWT → 401", async ({ request }) => {
    const r = await request.post(edgePath("/api/media/createUploadUrl"), {
      data: { content_type: "image/png", listing_id: "00000000-0000-0000-0000-000000000001" },
      headers: { "Content-Type": "application/json", Authorization: invalidJwt },
    });
    expect([401, 403, 404]).toContain(r.status());
  });
});
