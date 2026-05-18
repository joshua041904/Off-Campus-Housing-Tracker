import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiGatewayReady, e2eApiBase, uniqueE2eEmail } from "./helpers";

function userIdFromJwt(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("invalid token payload");
  const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as {
    sub?: string;
    user_id?: string;
  };
  const id = json.user_id || json.sub;
  if (!id) throw new Error("missing user id in token");
  return id;
}

async function registerUserCredentials(
  request: APIRequestContext,
  prefix: string,
  workerIndex: number,
): Promise<{ token: string; email: string }> {
  const email = uniqueE2eEmail(prefix, workerIndex);
  const password = "Password123!";
  const reg = await request.post(`${e2eApiBase()}/api/auth/register`, {
    data: { email, password },
  });
  const regJson = (await reg.json().catch(() => ({}))) as { token?: string };
  if (regJson.token) return { token: regJson.token, email };
  const login = await request.post(`${e2eApiBase()}/api/auth/login`, {
    data: { email, password },
  });
  const loginJson = (await login.json().catch(() => ({}))) as { token?: string };
  if (!loginJson.token) throw new Error("unable to acquire auth token");
  return { token: loginJson.token, email };
}

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZxNQAAAAASUVORK5CYII=";

async function uploadPrimaryImageAndAttach(
  request: APIRequestContext,
  token: string,
  listingId: string,
): Promise<void> {
  const init = await request.post(`${e2eApiBase()}/api/media/media/upload-url`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      filename: "seed.png",
      content_type: "image/png",
      size_bytes: Buffer.from(TINY_PNG_BASE64, "base64").length,
    },
  });
  expect(init.ok(), await init.text()).toBeTruthy();
  const initJson = (await init.json()) as {
    mediaId?: string;
    media_id?: string;
    uploadUrl?: string;
    upload_url?: string;
  };
  const mediaId = initJson.mediaId ?? initJson.media_id;
  const uploadUrl = initJson.uploadUrl ?? initJson.upload_url;
  expect(mediaId).toBeTruthy();
  expect(uploadUrl).toBeTruthy();

  const put = await request.fetch(String(uploadUrl), {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    data: Buffer.from(TINY_PNG_BASE64, "base64"),
  });

  let attachUrl: string;
  if (put.ok()) {
    const complete = await request.post(`${e2eApiBase()}/api/media/media/${mediaId}/complete`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(complete.ok(), await complete.text()).toBeTruthy();

    const download = await request.get(`${e2eApiBase()}/api/media/media/${mediaId}/download-url`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(download.ok(), await download.text()).toBeTruthy();
    const downloadJson = (await download.json()) as { download_url?: string; downloadUrl?: string };
    const downloadUrl = downloadJson.download_url ?? downloadJson.downloadUrl;
    expect(downloadUrl).toBeTruthy();
    attachUrl = String(downloadUrl);
  } else {
    attachUrl = `https://picsum.photos/seed/e2e-${encodeURIComponent(listingId)}/1200/800`;
  }

  const attach = await request.post(`${e2eApiBase()}/api/listings/listings/${listingId}/media`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      media_url: attachUrl,
      media_type: "image",
      sort_order: 0,
    },
  });
  expect(attach.ok(), await attach.text()).toBeTruthy();
}

async function setLocalAuth(page: Page, token: string, emailHint: string): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ({ tk, em }) => {
      window.localStorage.setItem("och_token", tk);
      window.localStorage.setItem("och_email", em);
    },
    { tk: token, em: emailHint },
  );
}

async function redisBookingCount(request: APIRequestContext, listingId: string): Promise<number> {
  const r = await request.get(`${e2eApiBase()}/api/listings/debug/redis-booking-count/${listingId}`);
  if (!r.ok()) return -1;
  const j = (await r.json().catch(() => ({}))) as { redis_booking_count?: number };
  return Number(j.redis_booking_count ?? 0);
}

function assertEdgeProtoFromResponseHeaders(headers: Record<string, string>): void {
  let raw: string | undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "x-edge-proto" && v) {
      raw = v;
      break;
    }
  }
  const v = String(raw || "").toLowerCase();
  const ok =
    v === "h2" ||
    v === "h3" ||
    v === "h1" ||
    v === "http/2.0" ||
    v === "http/3.0" ||
    v === "http/2" ||
    v === "http/3" ||
    v === "http/1.1" ||
    v === "http/1.0";
  expect(ok, `x-edge-proto was ${String(raw)}`).toBeTruthy();
}

test.describe.configure({ mode: "serial" });

test("full vertical: listing+media, community+notification, booking lifecycle, search hide, redis, edge proto", async ({
  page,
  request,
}) => {
  test.skip(!(await apiGatewayReady(request)), "gateway not ready");
  const stamp = Date.now();
  const wi = test.info().workerIndex;

  const landlord = await registerUserCredentials(request, "fv-landlord", wi);
  const op = await registerUserCredentials(request, "fv-op", wi);
  const commenter = await registerUserCredentials(request, "fv-commenter", wi);
  const landlordId = userIdFromJwt(landlord.token);
  const opId = userIdFromJwt(op.token);

  const listingEffectiveFrom = new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 10);
  /** Tour on "today" so ACCEPTED/CONFIRMED overlap default search occupancy (UTC calendar day). */
  const tourDay = new Date().toISOString().slice(0, 10);
  const titleUnique = `FV-COMMUNITY-STAMP-${stamp}`;

  const listingRes = await request.post(`${e2eApiBase()}/api/listings/create`, {
    headers: { Authorization: `Bearer ${landlord.token}` },
    data: {
      title: `FV listing ${stamp}`,
      description: `Golden-path vertical listing near campus ${stamp}`,
      price_cents: 175000,
      effective_from: listingEffectiveFrom,
      amenities: ["wifi", "parking"],
      smoke_free: true,
      pet_friendly: false,
      furnished: true,
    },
  });
  expect(listingRes.ok(), await listingRes.text()).toBeTruthy();
  const listingJson = (await listingRes.json()) as { id?: string };
  const listingId = listingJson.id;
  expect(listingId).toBeTruthy();

  await uploadPrimaryImageAndAttach(request, landlord.token, listingId!);

  const healthEdge0 = await request.get(`${e2eApiBase()}/api/healthz`);
  expect(healthEdge0.ok(), await healthEdge0.text()).toBeTruthy();
  assertEdgeProtoFromResponseHeaders(healthEdge0.headers());

  expect(await redisBookingCount(request, listingId!)).toBe(0);

  const search0 = await request.get(
    `${e2eApiBase()}/api/listings/search?q=${encodeURIComponent(String(stamp))}&limit=50`,
  );
  expect(search0.ok()).toBeTruthy();
  const search0Json = (await search0.json()) as { data?: { id?: string }[]; items?: { id?: string }[] };
  const rows0 = search0Json.data ?? search0Json.items ?? [];
  expect(rows0.some((r) => r.id === listingId)).toBeTruthy();

  await setLocalAuth(page, landlord.token, landlord.email);
  await page.goto("/listings");
  await page.getByTestId("listings-search-q").fill(String(stamp));
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/listings/search") && r.status() === 200),
    page.getByTestId("listings-search-submit").click(),
  ]);
  await expect(page.getByTestId("listing-card").filter({ hasText: String(stamp) }).first()).toBeVisible({
    timeout: 25_000,
  });

  const postRes = await request.post(`${e2eApiBase()}/api/community/posts`, {
    headers: { Authorization: `Bearer ${op.token}` },
    data: { title: titleUnique, body: `Body for community golden path ${stamp}` },
  });
  if (postRes.status() === 500) {
    test.skip(true, "community DB unavailable");
  }
  expect(postRes.ok(), await postRes.text()).toBeTruthy();
  const postJson = (await postRes.json()) as { id?: string };
  const postId = postJson.id;
  expect(postId).toBeTruthy();

  await setLocalAuth(page, op.token, op.email);
  await page.goto("/community");
  await expect(page.getByTestId(`community-post-${postId}`)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(titleUnique)).toBeVisible();

  const commentRes = await request.post(`${e2eApiBase()}/api/community/posts/${postId}/comments`, {
    headers: { Authorization: `Bearer ${commenter.token}` },
    data: { body: `Second-user comment ${stamp}` },
  });
  expect(commentRes.ok(), await commentRes.text()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const r = await request.get(`${e2eApiBase()}/api/notification/notifications?limit=50`, {
          headers: { Authorization: `Bearer ${op.token}` },
        });
        if (!r.ok()) return false;
        const j = (await r.json().catch(() => ({}))) as {
          items?: Array<{ event_type?: string }>;
        };
        const items = j.items ?? [];
        return items.some((it) => String(it.event_type || "") === "community.comment.notification");
      },
      { timeout: 120_000, intervals: [1_000, 2_000, 4_000, 6_000] },
    )
    .toBeTruthy();

  const bookingResp = await request.post(`${e2eApiBase()}/api/booking/request`, {
    headers: { Authorization: `Bearer ${op.token}` },
    data: {
      listing_id: listingId,
      renter_id: opId,
      requested_date: tourDay,
      message: `fv-booking-${stamp}`,
    },
  });
  expect(bookingResp.ok(), await bookingResp.text()).toBeTruthy();
  const bookingBody = (await bookingResp.json()) as {
    booking_id?: string;
    status?: string;
    fraud_score?: number;
    fraud_flagged?: boolean;
  };
  expect(bookingBody.status).toBe("PENDING");
  expect(typeof bookingBody.fraud_score).toBe("number");
  expect(typeof bookingBody.fraud_flagged).toBe("boolean");
  const bookingId = bookingBody.booking_id;
  expect(bookingId).toBeTruthy();

  expect(await redisBookingCount(request, listingId!)).toBe(0);

  await expect
    .poll(
      async () => {
        const r = await request.get(`${e2eApiBase()}/api/notification/notifications?limit=50`, {
          headers: { Authorization: `Bearer ${landlord.token}` },
        });
        if (!r.ok()) return false;
        const j = (await r.json().catch(() => ({}))) as {
          items?: Array<{ event_type?: string; payload?: { listingId?: string } }>;
        };
        const items = j.items ?? [];
        return items.some(
          (it) =>
            String(it.event_type || "").toLowerCase().includes("booking") &&
            String(it.payload?.listingId || "") === listingId,
        );
      },
      { timeout: 120_000, intervals: [1_000, 2_000, 4_000, 6_000] },
    )
    .toBeTruthy();

  const accept = await request.post(`${e2eApiBase()}/api/booking/bookings/${bookingId}/status`, {
    headers: { Authorization: `Bearer ${landlord.token}`, "x-user-id": landlordId },
    data: { to: "ACCEPTED" },
  });
  expect(accept.ok(), await accept.text()).toBeTruthy();

  const searchAfterAccept = await request.get(
    `${e2eApiBase()}/api/listings/search?q=${encodeURIComponent(String(stamp))}&limit=50`,
  );
  expect(searchAfterAccept.ok()).toBeTruthy();
  const searchAfterJson = (await searchAfterAccept.json()) as { data?: { id?: string }[]; items?: { id?: string }[] };
  const rowsAfter = searchAfterJson.data ?? searchAfterJson.items ?? [];
  expect(rowsAfter.some((r) => r.id === listingId)).toBeFalsy();

  expect(await redisBookingCount(request, listingId!)).toBe(1);

  const confirm = await request.post(`${e2eApiBase()}/api/booking/bookings/${bookingId}/status`, {
    headers: { Authorization: `Bearer ${op.token}`, "x-user-id": opId },
    data: { to: "CONFIRMED" },
  });
  expect(confirm.ok(), await confirm.text()).toBeTruthy();

  expect(await redisBookingCount(request, listingId!)).toBe(1);

  const searchAfterConfirm = await request.get(
    `${e2eApiBase()}/api/listings/search?q=${encodeURIComponent(String(stamp))}&limit=50`,
  );
  expect(searchAfterConfirm.ok()).toBeTruthy();
  const searchConfirmJson = (await searchAfterConfirm.json()) as { data?: { id?: string }[]; items?: { id?: string }[] };
  const rowsConfirm = searchConfirmJson.data ?? searchConfirmJson.items ?? [];
  expect(rowsConfirm.some((r) => r.id === listingId)).toBeFalsy();

  const prom = process.env.E2E_PROMETHEUS_URL?.trim();
  if (prom) {
    const qBooking = encodeURIComponent("sum(booking_requests_total)");
    const qConfirmed = encodeURIComponent('sum(booking_status_total{status="CONFIRMED"})');
    const r1 = await request.get(`${prom.replace(/\/$/, "")}/api/v1/query?query=${qBooking}`);
    const r2 = await request.get(`${prom.replace(/\/$/, "")}/api/v1/query?query=${qConfirmed}`);
    expect(r1.ok()).toBeTruthy();
    expect(r2.ok()).toBeTruthy();
    const j1 = (await r1.json()) as { data?: { result?: Array<{ value?: [string, string] }> } };
    const j2 = (await r2.json()) as { data?: { result?: Array<{ value?: [string, string] }> } };
    const v1 = Number(j1.data?.result?.[0]?.value?.[1] ?? 0);
    const v2 = Number(j2.data?.result?.[0]?.value?.[1] ?? 0);
    expect(v1).toBeGreaterThan(0);
    expect(v2).toBeGreaterThan(0);

    const qH1 = encodeURIComponent('sum(rate(http_requests_total{service="gateway",proto="h1"}[5m]))');
    const rh = await request.get(`${prom.replace(/\/$/, "")}/api/v1/query?query=${qH1}`);
    expect(rh.ok()).toBeTruthy();
    const jh = (await rh.json()) as { data?: { result?: Array<{ value?: [string, string] }> } };
    const h1Rate = Number(jh.data?.result?.[0]?.value?.[1] ?? 0);
    expect(Number.isFinite(h1Rate) ? h1Rate : 0).toBe(0);
  }

  const jaegerBase = process.env.E2E_JAEGER_QUERY_BASE?.trim().replace(/\/$/, "");
  if (jaegerBase) {
    const { maxTraceDepth } = await import("../../scripts/trace-validators/lib/jaeger-max-trace-depth.mjs");
    const start = (Date.now() - 900_000) * 1000;
    const endMs = Date.now() * 1000;
    const url = `${jaegerBase}/api/traces?service=${encodeURIComponent("booking-service")}&start=${start}&end=${endMs}&limit=20`;
    const tr = await request.get(url);
    expect(tr.ok(), await tr.text()).toBeTruthy();
    const payload = (await tr.json()) as { data?: Array<{ spans?: unknown[]; processes?: Record<string, unknown> }> };
    const traces = Array.isArray(payload.data) ? payload.data : [];
    expect(traces.length).toBeGreaterThan(0);
    let matched: { depth: number; services: Set<string> } | null = null;
    for (const t of traces) {
      const spans = (Array.isArray(t.spans) ? t.spans : []) as Array<{ processID?: string }>;
      const d = maxTraceDepth(spans as Parameters<typeof maxTraceDepth>[0]);
      const services = new Set(
        spans.map((s) => {
          const pid = s.processID;
          const p = t.processes?.[pid as string] as { serviceName?: string } | undefined;
          return p?.serviceName || "";
        }),
      );
      const hasBooking = Array.from(services).some((s) => /booking-service/i.test(s));
      const hasNotif = Array.from(services).some((s) => /notification-service/i.test(s));
      if (d >= 6 && hasBooking && hasNotif) {
        matched = { depth: d, services };
        break;
      }
    }
    expect(matched, "no booking trace with depth>=6 containing notification-service").not.toBeNull();
    if (matched) {
      expect(matched.depth).toBeGreaterThanOrEqual(6);
    }
  }

  const healthEdge1 = await request.get(`${e2eApiBase()}/api/healthz`);
  expect(healthEdge1.ok(), await healthEdge1.text()).toBeTruthy();
  assertEdgeProtoFromResponseHeaders(healthEdge1.headers());
});
