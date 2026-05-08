/**
 * Trust gRPC handler harness (no bind): pool mocked; exercises validation + DB paths + health check.
 */
import * as grpc from "@grpc/grpc-js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  trustGrpcHandlersForTest,
  trustGrpcHealthCheckForTest,
} from "../src/grpc-server.js";

const listingId = randomUUID();
const reporterId = randomUUID();
const targetUserId = randomUUID();
const bookingId = randomUUID();
const reviewerId = randomUUID();
const revieweeId = randomUUID();

const { poolQuery } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}));

let failNextInsert = false;
let dupNextListingFlag = false;
let dupNextReview = false;

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

describe("trust grpc-server handlers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    failNextInsert = false;
    dupNextListingFlag = false;
    dupNextReview = false;
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (failNextInsert) {
        failNextInsert = false;
        throw new Error("db unavailable");
      }
      if (text.includes("SELECT 1") && !text.includes("reputation")) {
        return { rows: [{ ok: 1 }] };
      }
      if (
        text.includes("INSERT INTO trust.listing_flags") &&
        text.includes("(listing_id, reporter_id, reason)") &&
        !text.includes("description")
      ) {
        if (dupNextListingFlag) {
          dupNextListingFlag = false;
          const e = Object.assign(new Error("duplicate"), { code: "23505" });
          throw e;
        }
        return { rows: [{ id: randomUUID(), status: "open" }] };
      }
      if (text.includes("INSERT INTO trust.listing_flags") && text.includes("description")) {
        return { rows: [{ id: randomUUID(), status: "open" }] };
      }
      if (text.includes("INSERT INTO trust.user_flags")) {
        return { rows: [{ id: randomUUID(), status: "open" }] };
      }
      if (text.includes("INSERT INTO trust.reviews")) {
        if (dupNextReview) {
          dupNextReview = false;
          const e = Object.assign(new Error("unique violation"), { code: "23505" });
          throw e;
        }
        return { rows: [{ id: randomUUID() }] };
      }
      if (text.includes("FROM trust.reputation")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
  });

  describe("trustGrpcHealthCheckForTest", () => {
    it("returns true when DB not required", async () => {
      vi.stubEnv("TRUST_GRPC_HEALTH_REQUIRES_DB", "0");
      await expect(trustGrpcHealthCheckForTest()).resolves.toBe(true);
      expect(poolQuery).not.toHaveBeenCalled();
    });

    it("returns true when SELECT 1 succeeds", async () => {
      vi.stubEnv("TRUST_GRPC_HEALTH_REQUIRES_DB", "1");
      await expect(trustGrpcHealthCheckForTest()).resolves.toBe(true);
      expect(poolQuery).toHaveBeenCalled();
    });

    it("returns false when SELECT 1 fails", async () => {
      vi.stubEnv("TRUST_GRPC_HEALTH_REQUIRES_DB", "1");
      poolQuery.mockRejectedValueOnce(new Error("down"));
      await expect(trustGrpcHealthCheckForTest()).resolves.toBe(false);
    });
  });

  describe("FlagListing", () => {
    it("INVALID_ARGUMENT when fields missing", async () => {
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.FlagListing({ request: { listing_id: listingId } }, cb),
      );
      expect(err).toBeTruthy();
      expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it("INVALID_ARGUMENT when listing_id not a UUID", async () => {
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.FlagListing(
          { request: { listing_id: "bad", reporter_id: reporterId, reason: "spam" } },
          cb,
        ),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it("INVALID_ARGUMENT when reporter_id not a UUID", async () => {
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.FlagListing(
          { request: { listing_id: listingId, reporter_id: "bad", reason: "spam" } },
          cb,
        ),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it("success", async () => {
      const { err, res } = await runCallback((cb) =>
        trustGrpcHandlersForTest.FlagListing(
          { request: { listing_id: listingId, reporter_id: reporterId, reason: "scam" } },
          cb,
        ),
      );
      expect(err).toBeNull();
      expect((res as { flag_id: string }).flag_id).toBeDefined();
      expect((res as { status: string }).status).toBe("open");
    });

    it("ALREADY_EXISTS on duplicate flag", async () => {
      dupNextListingFlag = true;
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.FlagListing(
          { request: { listing_id: listingId, reporter_id: reporterId, reason: "dup" } },
          cb,
        ),
      );
      expect((err as { code: number }).code).toBe(grpc.status.ALREADY_EXISTS);
    });

    it("INTERNAL on unexpected DB error", async () => {
      failNextInsert = true;
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.FlagListing(
          { request: { listing_id: listingId, reporter_id: reporterId, reason: "x" } },
          cb,
        ),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
    });
  });

  describe("ReportAbuse", () => {
    it("INVALID_ARGUMENT when abuse_target_type invalid", async () => {
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.ReportAbuse(
          {
            request: {
              abuse_target_type: "other",
              target_id: listingId,
              reporter_id: reporterId,
            },
          },
          cb,
        ),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it("INVALID_ARGUMENT when target_id invalid UUID", async () => {
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.ReportAbuse(
          {
            request: {
              abuse_target_type: "listing",
              target_id: "nope",
              reporter_id: reporterId,
            },
          },
          cb,
        ),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it("listing branch — success", async () => {
      const { err, res } = await runCallback((cb) =>
        trustGrpcHandlersForTest.ReportAbuse(
          {
            request: {
              abuse_target_type: "listing",
              target_id: listingId,
              reporter_id: reporterId,
              category: "fraud",
              details: "details here",
            },
          },
          cb,
        ),
      );
      expect(err).toBeNull();
      expect((res as { status: string }).status).toBe("open");
    });

    it("user branch — success", async () => {
      const { err, res } = await runCallback((cb) =>
        trustGrpcHandlersForTest.ReportAbuse(
          {
            request: {
              abuse_target_type: "user",
              target_id: targetUserId,
              reporter_id: reporterId,
              category: "abuse",
            },
          },
          cb,
        ),
      );
      expect(err).toBeNull();
      expect((res as { flag_id: string }).flag_id).toBeDefined();
    });

    it("ALREADY_EXISTS on duplicate (listing)", async () => {
      poolQuery.mockImplementationOnce(async () => {
        const e = Object.assign(new Error("dup"), { code: "23505" });
        throw e;
      });
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.ReportAbuse(
          {
            request: {
              abuse_target_type: "listing",
              target_id: listingId,
              reporter_id: reporterId,
            },
          },
          cb,
        ),
      );
      expect((err as { code: number }).code).toBe(grpc.status.ALREADY_EXISTS);
    });
  });

  describe("SubmitReview", () => {
    it("INVALID_ARGUMENT when rating missing", async () => {
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.SubmitReview(
          {
            request: {
              booking_id: bookingId,
              reviewer_id: reviewerId,
              reviewee_id: revieweeId,
            },
          },
          cb,
        ),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it("INVALID_ARGUMENT when reviewee_id empty", async () => {
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.SubmitReview(
          {
            request: {
              booking_id: bookingId,
              reviewer_id: reviewerId,
              rating: 5,
            },
          },
          cb,
        ),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it("success", async () => {
      const { err, res } = await runCallback((cb) =>
        trustGrpcHandlersForTest.SubmitReview(
          {
            request: {
              booking_id: bookingId,
              reviewer_id: reviewerId,
              reviewee_id: revieweeId,
              rating: 4,
              comment: "great",
            },
          },
          cb,
        ),
      );
      expect(err).toBeNull();
      expect((res as { review_id: string }).review_id).toBeDefined();
    });

    it("ALREADY_EXISTS on duplicate review", async () => {
      dupNextReview = true;
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.SubmitReview(
          {
            request: {
              booking_id: bookingId,
              reviewer_id: reviewerId,
              reviewee_id: revieweeId,
              rating: 5,
            },
          },
          cb,
        ),
      );
      expect((err as { code: number }).code).toBe(grpc.status.ALREADY_EXISTS);
    });
  });

  describe("SubmitPeerReview", () => {
    it("INVALID_ARGUMENT when fields incomplete", async () => {
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.SubmitPeerReview(
          { request: { booking_id: bookingId, reviewer_id: reviewerId, rating: 3 } },
          cb,
        ),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it("success", async () => {
      const { err, res } = await runCallback((cb) =>
        trustGrpcHandlersForTest.SubmitPeerReview(
          {
            request: {
              booking_id: bookingId,
              reviewer_id: reviewerId,
              reviewee_id: revieweeId,
              side: "tenant",
              rating: 5,
              comment: "ok",
            },
          },
          cb,
        ),
      );
      expect(err).toBeNull();
      expect((res as { review_id: string }).review_id).toBeDefined();
    });
  });

  describe("GetReputation", () => {
    it("INVALID_ARGUMENT when user_id missing", async () => {
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.GetReputation({ request: {} }, cb),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it("INVALID_ARGUMENT when user_id not UUID", async () => {
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.GetReputation({ request: { user_id: "x" } }, cb),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it("score 0 when no reputation row (default pool)", async () => {
      const uid = randomUUID();
      const { err, res } = await runCallback((cb) =>
        trustGrpcHandlersForTest.GetReputation({ request: { user_id: uid } }, cb),
      );
      expect(err).toBeNull();
      expect((res as { score: number }).score).toBe(0);
    });

    it("returns score from row", async () => {
      const uid = randomUUID();
      poolQuery.mockImplementation(async (sql: unknown) => {
        const text = String(sql);
        if (text.includes("FROM trust.reputation")) {
          return { rows: [{ user_id: uid, reputation_score: "12" }] };
        }
        if (text.includes("SELECT 1")) return { rows: [{ ok: 1 }] };
        return { rows: [] };
      });
      const { err, res } = await runCallback((cb) =>
        trustGrpcHandlersForTest.GetReputation({ request: { user_id: uid } }, cb),
      );
      expect(err).toBeNull();
      expect((res as { score: number }).score).toBe(12);
    });

    it("INTERNAL on DB error", async () => {
      const uid = randomUUID();
      poolQuery.mockRejectedValueOnce(new Error("db"));
      const { err } = await runCallback((cb) =>
        trustGrpcHandlersForTest.GetReputation({ request: { user_id: uid } }, cb),
      );
      expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
    });
  });
});
