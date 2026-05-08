/**
 * Listings gRPC handler harness: mocked pool + Kafka publish + analytics sync (no bind).
 */
import * as grpc from "@grpc/grpc-js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listingsGrpcHandlersForTest,
  listingsGrpcHealthCheckForTest,
} from "../src/grpc-server.js";
import * as analyticsSync from "../src/analytics-sync.js";
import * as listingKafka from "../src/listing-kafka.js";

const userId = randomUUID();
const listingId = randomUUID();

const { poolQuery } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}));

vi.mock("../src/listing-kafka.js", () => ({
  publishListingEventForCreateResponse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/analytics-sync.js", () => ({
  syncListingCreatedToAnalytics: vi.fn().mockResolvedValue(undefined),
}));

function runCallback<T>(
  invoke: (cb: (err: T | null, res?: unknown) => void) => void,
): Promise<{ err: T | null; res?: unknown }> {
  return new Promise((resolve, reject) => {
    try {
      invoke((err, res) => {
        resolve({ err, res });
      });
    } catch (e) {
      reject(e);
    }
  });
}

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    title: "Studio near campus",
    description: "Quiet, sunny.",
    price_cents: 120000,
    amenities: ["wifi"],
    smoke_free: true,
    pet_friendly: false,
    furnished: true,
    effective_from: "2030-01-15",
    effective_until: "",
    ...overrides,
  };
}

function sampleListingRow(id: string, uid: string) {
  return {
    id,
    user_id: uid,
    title: "Studio near campus",
    description: "Quiet, sunny.",
    price_cents: 120000,
    amenities: ["wifi"],
    smoke_free: true,
    pet_friendly: false,
    furnished: true,
    status: "active",
    created_at: new Date("2030-01-20T12:00:00.000Z"),
    listed_at: new Date("2030-01-20T12:00:00.000Z"),
    latitude: null,
    longitude: null,
  };
}

describe("listings grpc-server handlers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.mocked(listingKafka.publishListingEventForCreateResponse).mockResolvedValue(undefined);
    vi.mocked(analyticsSync.syncListingCreatedToAnalytics).mockResolvedValue(undefined);
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes("SELECT 1") && !text.includes("FROM listings")) {
        return { rows: [{ ok: 1 }] };
      }
      if (text.includes("INSERT INTO listings.listings")) {
        return { rows: [sampleListingRow(listingId, userId)] };
      }
      if (text.includes("WHERE id = $1::uuid") && text.includes("LIMIT 1")) {
        return { rows: [sampleListingRow(listingId, userId)] };
      }
      if (text.includes("FROM listings.listings") && text.includes("OFFSET")) {
        return { rows: [sampleListingRow(listingId, userId)] };
      }
      return { rows: [] };
    });
  });

  describe("listingsGrpcHealthCheckForTest", () => {
    it("returns true when SELECT 1 succeeds", async () => {
      await expect(listingsGrpcHealthCheckForTest()).resolves.toBe(true);
    });

    it("returns false when pool throws", async () => {
      poolQuery.mockRejectedValueOnce(new Error("db down"));
      await expect(listingsGrpcHealthCheckForTest()).resolves.toBe(false);
    });
  });

  describe("CreateListing", () => {
    it("INVALID_ARGUMENT when validation fails", async () => {
      const { err } = await runCallback((cb) =>
        listingsGrpcHandlersForTest.CreateListing({ request: { user_id: userId } }, cb),
      );
      expect(err).toBeTruthy();
      expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it("success", async () => {
      const { err, res } = await runCallback((cb) =>
        listingsGrpcHandlersForTest.CreateListing({ request: validCreateBody() }, cb),
      );
      expect(err).toBeNull();
      expect((res as { listing_id: string }).listing_id).toBe(listingId);
      expect(vi.mocked(analyticsSync.syncListingCreatedToAnalytics)).toHaveBeenCalled();
      expect(vi.mocked(listingKafka.publishListingEventForCreateResponse)).toHaveBeenCalled();
    });

    it("INTERNAL when INSERT fails", async () => {
      poolQuery.mockRejectedValueOnce(new Error("insert failed"));
      const { err } = await runCallback((cb) =>
        listingsGrpcHandlersForTest.CreateListing({ request: validCreateBody() }, cb),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
    });

    it("INTERNAL when analytics sync fails", async () => {
      vi.mocked(analyticsSync.syncListingCreatedToAnalytics).mockRejectedValueOnce(
        new Error("analytics down"),
      );
      const { err } = await runCallback((cb) =>
        listingsGrpcHandlersForTest.CreateListing({ request: validCreateBody() }, cb),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
      expect(String((err as { message?: string }).message)).toContain("analytics");
    });

    it("INTERNAL when Kafka publish fails", async () => {
      vi.mocked(listingKafka.publishListingEventForCreateResponse).mockRejectedValueOnce(
        new Error("kafka down"),
      );
      const { err } = await runCallback((cb) =>
        listingsGrpcHandlersForTest.CreateListing({ request: validCreateBody() }, cb),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
      expect(String((err as { message?: string }).message)).toContain("listing event publish failed");
    });
  });

  describe("GetListing", () => {
    it("INVALID_ARGUMENT when listing_id invalid", async () => {
      const { err } = await runCallback((cb) =>
        listingsGrpcHandlersForTest.GetListing({ request: { listing_id: "not-a-uuid" } }, cb),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it("NOT_FOUND when missing", async () => {
      poolQuery.mockImplementation(async (sql: unknown) => {
        const text = String(sql);
        if (text.includes("WHERE id = $1::uuid") && text.includes("LIMIT 1")) {
          return { rows: [] };
        }
        if (text.includes("SELECT 1") && !text.includes("FROM listings")) {
          return { rows: [{ ok: 1 }] };
        }
        return { rows: [] };
      });
      const { err } = await runCallback((cb) =>
        listingsGrpcHandlersForTest.GetListing({ request: { listing_id: randomUUID() } }, cb),
      );
      expect((err as { code: number }).code).toBe(grpc.status.NOT_FOUND);
    });

    it("success", async () => {
      const { err, res } = await runCallback((cb) =>
        listingsGrpcHandlersForTest.GetListing({ request: { listing_id: listingId } }, cb),
      );
      expect(err).toBeNull();
      expect((res as { listing_id: string }).listing_id).toBe(listingId);
    });

    it("INTERNAL on pool error", async () => {
      poolQuery.mockRejectedValueOnce(new Error("db"));
      const { err } = await runCallback((cb) =>
        listingsGrpcHandlersForTest.GetListing({ request: { listing_id: listingId } }, cb),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
    });
  });

  describe("SearchListings", () => {
    it("returns listings array", async () => {
      const { err, res } = await runCallback((cb) =>
        listingsGrpcHandlersForTest.SearchListings(
          { request: { query: "studio", limit: 10, offset: 0 } },
          cb,
        ),
      );
      expect(err).toBeNull();
      expect(Array.isArray((res as { listings: unknown[] }).listings)).toBe(true);
      expect((res as { listings: unknown[] }).listings.length).toBeGreaterThan(0);
    });

    it("INTERNAL on search failure", async () => {
      poolQuery.mockRejectedValueOnce(new Error("search failed"));
      const { err } = await runCallback((cb) =>
        listingsGrpcHandlersForTest.SearchListings({ request: {} }, cb),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
    });
  });
});
