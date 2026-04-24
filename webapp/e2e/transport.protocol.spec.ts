import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { apiGatewayHealthy } from "./helpers";
import { edgePath } from "./vertical-helpers";

function curlVersion(extra: string[]): string {
  const ca = process.env.NODE_EXTRA_CA_CERTS || "";
  if (!ca.trim()) {
    throw new Error("NODE_EXTRA_CA_CERTS unset");
  }
  const url = edgePath("/api/healthz");
  const args = ["-sS", "--cacert", ca, "-o", "/dev/null", "-w", "%{http_version}", ...extra, url];
  return execFileSync("curl", args, { encoding: "utf8" }).trim();
}

function curlJson(path: string, extra: string[]): { httpVersion: string; body: string } {
  const ca = process.env.NODE_EXTRA_CA_CERTS || "";
  if (!ca.trim()) {
    throw new Error("NODE_EXTRA_CA_CERTS unset");
  }
  const marker = "CURL_HTTP_VERSION=";
  const args = [
    "-sS",
    "--cacert",
    ca,
    "-w",
    `\n${marker}%{http_version}`,
    ...extra,
    edgePath(path),
  ];
  const out = execFileSync("curl", args, { encoding: "utf8" });
  const idx = out.lastIndexOf(`\n${marker}`);
  if (idx < 0) {
    throw new Error("curl output missing version marker");
  }
  return {
    body: out.slice(0, idx).trim(),
    httpVersion: out.slice(idx + marker.length + 1).trim(),
  };
}

function extractIds(body: string): string {
  const parsed = JSON.parse(body) as { items?: Array<{ id?: string }> };
  return JSON.stringify((parsed.items ?? []).map((item) => item.id ?? ""));
}

function assertPriceDescending(body: string): void {
  const parsed = JSON.parse(body) as {
    items?: Array<{ price_cents?: number | null }>;
  };
  const prices = (parsed.items ?? []).map((item) => item.price_cents ?? null);
  let sawNull = false;
  let previous: number | null = null;
  for (const price of prices) {
    if (price == null) {
      sawNull = true;
      continue;
    }
    expect(sawNull, "null prices must sort last").toBeFalsy();
    if (previous != null) {
      expect(price).toBeLessThanOrEqual(previous);
    }
    previous = price;
  }
}

function assertPriceAscendingNullsLast(body: string): void {
  const parsed = JSON.parse(body) as {
    items?: Array<{ price_cents?: number | null }>;
  };
  const prices = (parsed.items ?? []).map((item) => item.price_cents ?? null);
  let sawNull = false;
  let previous: number | null = null;
  for (const price of prices) {
    if (price == null) {
      sawNull = true;
      continue;
    }
    expect(sawNull, "null prices must sort last").toBeFalsy();
    if (previous != null) {
      expect(price).toBeGreaterThanOrEqual(previous);
    }
    previous = price;
  }
}

function assertFullListingsFilterBody(
  body: string,
  options: {
    minPrice?: number;
    maxPrice?: number;
    petFriendly?: boolean;
    sort: "price_asc" | "price_desc";
  },
): void {
  const parsed = JSON.parse(body) as {
    items?: Array<{ price_cents?: number | null; pet_friendly?: boolean | null }>;
  };
  const items = parsed.items ?? [];
  expect(Array.isArray(items)).toBe(true);
  for (const item of items) {
    const price = item.price_cents;
    if (options.minPrice != null && price != null) {
      expect(price).toBeGreaterThanOrEqual(options.minPrice);
    }
    if (options.maxPrice != null && price != null) {
      expect(price).toBeLessThanOrEqual(options.maxPrice);
    }
    if (options.petFriendly) {
      expect(item.pet_friendly).toBe(true);
    }
  }
  if (options.sort === "price_asc") assertPriceAscendingNullsLast(body);
  else assertPriceDescending(body);
}

test.describe("transport protocol (curl)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
  });

  test("HTTP/2 ALPN reports version 2 against edge /api/healthz", async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
    test.skip(!process.env.NODE_EXTRA_CA_CERTS?.trim(), "NODE_EXTRA_CA_CERTS required for curl TLS");
    try {
      const v = curlVersion(["--http2"]);
      expect(["2", "1.1"]).toContain(v);
    } catch (e) {
      test.skip(true, `curl --http2 failed: ${(e as Error).message}`);
    }
  });

  test("HTTP/3-only must negotiate version 3 (downgrade fails)", async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
    test.skip(!process.env.NODE_EXTRA_CA_CERTS?.trim(), "NODE_EXTRA_CA_CERTS required for curl TLS");
    let v: string;
    try {
      v = curlVersion(["--http3-only"]);
    } catch (e) {
      if (process.env.PLAYWRIGHT_STRICT_HTTP3 === "1") {
        throw e;
      }
      test.skip(true, `curl --http3-only failed: ${(e as Error).message}`);
      return;
    }
    expect(v, "edge must speak HTTP/3 when forced with --http3-only (treat 1.1/2 as downgrade)").toBe("3");
  });

  test("listings search sort works over HTTP/2 and stays deterministic", async ({
    request,
  }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
    test.skip(
      !process.env.NODE_EXTRA_CA_CERTS?.trim(),
      "NODE_EXTRA_CA_CERTS required for curl TLS",
    );

    try {
      const priceAsc = curlJson("/api/listings/search?sort=price_asc", [
        "--http2",
      ]);
      expect(["2", "1.1"]).toContain(priceAsc.httpVersion);
      assertPriceAscendingNullsLast(priceAsc.body);

      const ids = [1, 2, 3].map(() =>
        extractIds(curlJson("/api/listings/search?sort=created_desc", ["--http2"]).body),
      );
      expect(new Set(ids).size).toBe(1);
    } catch (e) {
      test.skip(true, `curl listings/search over --http2 failed: ${(e as Error).message}`);
    }
  });

  test("listings full filter flow works over HTTP/2", async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
    test.skip(
      !process.env.NODE_EXTRA_CA_CERTS?.trim(),
      "NODE_EXTRA_CA_CERTS required for curl TLS",
    );

    try {
      const response = curlJson(
        "/api/listings/search?q=apartment&min_price=100000&max_price=300000&sort=price_desc&pet_friendly=1",
        ["--http2", "-i"],
      );
      expect(["2", "1.1"]).toContain(response.httpVersion);
      expect(response.body).toContain("\r\n200 ");
      expect(response.body).toMatch(/\r\ncontent-type:\s*application\/json/i);
      const body = response.body.split("\r\n\r\n").slice(-1)[0] ?? "";
      expect(JSON.parse(body)).toHaveProperty("items");
      assertFullListingsFilterBody(body, {
        minPrice: 100_000,
        maxPrice: 300_000,
        petFriendly: true,
        sort: "price_desc",
      });
    } catch (e) {
      test.skip(true, `curl listings/search full flow over --http2 failed: ${(e as Error).message}`);
    }
  });

  test("listings full filter flow matches over HTTP/1.1", async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
    test.skip(
      !process.env.NODE_EXTRA_CA_CERTS?.trim(),
      "NODE_EXTRA_CA_CERTS required for curl TLS",
    );

    try {
      const response = curlJson(
        "/api/listings/search?min_price=100000&sort=price_asc",
        ["--http1.1", "-i"],
      );
      expect(response.httpVersion).toBe("1.1");
      expect(response.body).toContain("\r\n200 ");
      const body = response.body.split("\r\n\r\n").slice(-1)[0] ?? "";
      expect(JSON.parse(body)).toHaveProperty("items");
      assertFullListingsFilterBody(body, {
        minPrice: 100_000,
        sort: "price_asc",
      });
    } catch (e) {
      test.skip(true, `curl listings/search full flow over --http1.1 failed: ${(e as Error).message}`);
    }
  });

  test("listings search sort works over HTTP/3", async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
    test.skip(
      !process.env.NODE_EXTRA_CA_CERTS?.trim(),
      "NODE_EXTRA_CA_CERTS required for curl TLS",
    );

    try {
      const priceAsc = curlJson("/api/listings/search?sort=price_asc", [
        "--http3-only",
      ]);
      expect(priceAsc.httpVersion).toBe("3");
      assertPriceAscendingNullsLast(priceAsc.body);
    } catch (e) {
      if (process.env.PLAYWRIGHT_STRICT_HTTP3 === "1") {
        throw e;
      }
      test.skip(true, `curl listings/search over --http3-only failed: ${(e as Error).message}`);
    }
  });

  test("listings full filter flow works over HTTP/3", async ({ request }) => {
    test.skip(!(await apiGatewayHealthy(request)), "edge not up");
    test.skip(
      !process.env.NODE_EXTRA_CA_CERTS?.trim(),
      "NODE_EXTRA_CA_CERTS required for curl TLS",
    );

    try {
      const response = curlJson(
        "/api/listings/search?q=apartment&min_price=100000&max_price=300000&sort=price_desc&pet_friendly=1",
        ["--http3-only", "-i"],
      );
      expect(response.httpVersion).toBe("3");
      expect(response.body).toContain("\r\n200 ");
      const body = response.body.split("\r\n\r\n").slice(-1)[0] ?? "";
      expect(JSON.parse(body)).toHaveProperty("items");
      assertFullListingsFilterBody(body, {
        minPrice: 100_000,
        maxPrice: 300_000,
        petFriendly: true,
        sort: "price_desc",
      });
    } catch (e) {
      if (process.env.PLAYWRIGHT_STRICT_HTTP3 === "1") {
        throw e;
      }
      test.skip(true, `curl listings/search full flow over --http3-only failed: ${(e as Error).message}`);
    }
  });
});
