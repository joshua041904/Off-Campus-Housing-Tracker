import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/listing-kafka.js", () => ({
  publishListingEvent: vi.fn(),
}));

vi.mock("../src/analytics-sync.js", () => ({
  syncListingCreatedToAnalytics: vi.fn().mockResolvedValue(undefined),
}));

describe("createListingsHttpApp", () => {
  let createListingsHttpApp: typeof import("../src/http-server.js").createListingsHttpApp;

  beforeAll(async () => {
    ({ createListingsHttpApp } = await import("../src/http-server.js"));
  });

  it("returns an express application", () => {
    const app = createListingsHttpApp();
    expect(app).toBeDefined();
    expect(typeof (app as { use?: unknown }).use).toBe("function");
  });
});
