/**
 * Direct gRPC handler coverage for `grpc-server.ts` (mock pool + Ollama).
 */
import * as grpc from "@grpc/grpc-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { poolQuery, analyzeFeel } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  analyzeFeel: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  pool: { query: (...a: unknown[]) => poolQuery(...a) },
}));

vi.mock("../src/ollama.js", () => ({
  analyzeListingFeelText: (...a: unknown[]) => analyzeFeel(...a),
}));

const {
  analyticsGrpcHandlers,
  analyticsRecommendationAdminGrpcHandlers,
  analyticsGrpcHealthProbe,
} = await import("../src/grpc-server.js");

function runRpc<T extends Record<string, unknown>>(
  handler: (call: { request: T }, cb: grpc.sendUnaryData<unknown>) => void,
  request: T,
): Promise<{ err: grpc.ServiceError | null; res: unknown }> {
  return new Promise((resolve) => {
    handler({ request } as grpc.ServerUnaryCall<T, unknown>, (err, res) => {
      resolve({ err: err as grpc.ServiceError | null, res });
    });
  });
}

describe("analyticsGrpcHandlers", () => {
  beforeEach(() => {
    poolQuery.mockReset();
    analyzeFeel.mockReset();
    poolQuery.mockResolvedValue({ rows: [] });
  });

  it("GetDailyMetrics — INVALID_ARGUMENT when date missing", async () => {
    const { err, res } = await runRpc(analyticsGrpcHandlers.GetDailyMetrics, {
      date: "",
    } as { date: string });
    expect(res).toBeUndefined();
    expect(err?.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("GetDailyMetrics — zeros when no row", async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const { err, res } = await runRpc(analyticsGrpcHandlers.GetDailyMetrics, {
      date: "2026-01-01",
    });
    expect(err).toBeNull();
    expect(res).toMatchObject({
      new_users: 0,
      new_listings: 0,
      new_bookings: 0,
      completed_bookings: 0,
      messages_sent: 0,
      listings_flagged: 0,
    });
  });

  it("GetDailyMetrics — returns row", async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [
        {
          new_users: 1,
          new_listings: 2,
          new_bookings: 3,
          completed_bookings: 4,
          messages_sent: 5,
          listings_flagged: 6,
        },
      ],
    });
    const { err, res } = await runRpc(analyticsGrpcHandlers.GetDailyMetrics, {
      date: "2026-02-02",
    });
    expect(err).toBeNull();
    expect(res).toMatchObject({
      new_users: 1,
      new_listings: 2,
      new_bookings: 3,
      completed_bookings: 4,
      messages_sent: 5,
      listings_flagged: 6,
    });
  });

  it("GetDailyMetrics — INTERNAL on DB error", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const { err } = await runRpc(analyticsGrpcHandlers.GetDailyMetrics, {
      date: "2026-03-03",
    });
    expect(err?.code).toBe(grpc.status.INTERNAL);
  });

  it("GetRecommendations — baseline on empty", async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const { err, res } = await runRpc(
      analyticsGrpcHandlers.GetRecommendations,
      {} as Record<string, never>,
    );
    expect(err).toBeNull();
    expect(res).toMatchObject({
      model_name: "baseline",
      model_version: "v0",
      listings: [],
    });
  });

  it("GetRecommendations — uses active model row", async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [{ name: "m1", version: "v2" }],
    });
    const { err, res } = await runRpc(
      analyticsGrpcHandlers.GetRecommendations,
      {} as Record<string, never>,
    );
    expect(err).toBeNull();
    expect(res).toMatchObject({ model_name: "m1", model_version: "v2" });
  });

  it("GetRecommendations — swallow DB error with baseline", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const { err, res } = await runRpc(
      analyticsGrpcHandlers.GetRecommendations,
      {} as Record<string, never>,
    );
    expect(err).toBeNull();
    expect(res).toMatchObject({ model_name: "baseline" });
  });

  it("GetWatchlistInsights — INVALID_ARGUMENT", async () => {
    const { err } = await runRpc(analyticsGrpcHandlers.GetWatchlistInsights, {
      user_id: "",
    } as { user_id: string });
    expect(err?.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("GetWatchlistInsights — success", async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ a: 3, r: 1 }] });
    const { err, res } = await runRpc(
      analyticsGrpcHandlers.GetWatchlistInsights,
      { user_id: "00000000-0000-4000-8000-000000000001" },
    );
    expect(err).toBeNull();
    expect(res).toMatchObject({
      watchlist_adds_30d: 3,
      watchlist_removes_30d: 1,
    });
  });

  it("GetWatchlistInsights — INTERNAL on error", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const { err } = await runRpc(analyticsGrpcHandlers.GetWatchlistInsights, {
      user_id: "00000000-0000-4000-8000-000000000002",
    });
    expect(err?.code).toBe(grpc.status.INTERNAL);
  });

  it("AnalyzeListingFeel — INVALID_ARGUMENT", async () => {
    const { err } = await runRpc(analyticsGrpcHandlers.AnalyzeListingFeel, {
      title: "",
      price_cents: NaN,
    } as { title: string; price_cents: number });
    expect(err?.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("AnalyzeListingFeel — success", async () => {
    analyzeFeel.mockResolvedValueOnce({
      analysis_text: "- ok",
      model_used: "test",
      quality_score: 0.5,
    });
    const { err, res } = await runRpc(analyticsGrpcHandlers.AnalyzeListingFeel, {
      title: "T",
      description: "D",
      price_cents: 100,
      audience: "renter",
    });
    expect(err).toBeNull();
    expect(res).toMatchObject({ model_used: "test" });
  });

  it("AnalyzeListingFeel — INTERNAL on analyzer error", async () => {
    analyzeFeel.mockRejectedValueOnce(new Error("ollama"));
    const { err } = await runRpc(analyticsGrpcHandlers.AnalyzeListingFeel, {
      title: "T",
      price_cents: 100,
    });
    expect(err?.code).toBe(grpc.status.INTERNAL);
  });
});

describe("analyticsRecommendationAdminGrpcHandlers", () => {
  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockResolvedValue({ rows: [] });
  });

  it("ActivateModel — INVALID_ARGUMENT", async () => {
    const { err } = await runRpc(
      analyticsRecommendationAdminGrpcHandlers.ActivateModel,
      { name: "", version: "" },
    );
    expect(err?.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("ActivateModel — success", async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const { err, res } = await runRpc(
      analyticsRecommendationAdminGrpcHandlers.ActivateModel,
      { name: "m", version: "v1" },
    );
    expect(err).toBeNull();
    expect(res).toEqual({});
  });

  it("ActivateModel — INTERNAL on failure", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const { err } = await runRpc(
      analyticsRecommendationAdminGrpcHandlers.ActivateModel,
      { name: "m", version: "v1" },
    );
    expect(err?.code).toBe(grpc.status.INTERNAL);
  });

  it("SetExperimentTraffic — INVALID_ARGUMENT", async () => {
    const { err } = await runRpc(
      analyticsRecommendationAdminGrpcHandlers.SetExperimentTraffic,
      { experiment_name: "", traffic_percentage: 1.5 },
    );
    expect(err?.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("SetExperimentTraffic — success", async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const { err, res } = await runRpc(
      analyticsRecommendationAdminGrpcHandlers.SetExperimentTraffic,
      { experiment_name: "exp_a", traffic_percentage: 50 },
    );
    expect(err).toBeNull();
    expect(res).toEqual({});
  });

  it("SetExperimentTraffic — INTERNAL on failure", async () => {
    poolQuery.mockRejectedValueOnce(new Error("db"));
    const { err } = await runRpc(
      analyticsRecommendationAdminGrpcHandlers.SetExperimentTraffic,
      { experiment_name: "exp_a", traffic_percentage: 10 },
    );
    expect(err?.code).toBe(grpc.status.INTERNAL);
  });
});

describe("analyticsGrpcHealthProbe", () => {
  beforeEach(() => {
    poolQuery.mockReset();
  });

  it("returns true when SELECT 1 succeeds", async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{}] });
    await expect(analyticsGrpcHealthProbe()).resolves.toBe(true);
  });

  it("returns false when pool fails", async () => {
    poolQuery.mockRejectedValueOnce(new Error("down"));
    await expect(analyticsGrpcHealthProbe()).resolves.toBe(false);
  });
});
