/**
 * Direct invocation of notification gRPC handlers (no bind/listen).
 */
import * as grpc from "@grpc/grpc-js";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const userId = randomUUID(); // stable UUID for preference lookups

const { poolQuery } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  pool: {
    query: (...args: unknown[]) => poolQuery(...args),
  },
}));

describe("notificationGrpcHandlers", () => {
  let notificationGrpcHandlers: typeof import("../src/grpc-server.js").notificationGrpcHandlers;
  let notificationGrpcHealthCheck: typeof import("../src/grpc-server.js").notificationGrpcHealthCheck;

  beforeAll(async () => {
    const mod = await import("../src/grpc-server.js");
    notificationGrpcHandlers = mod.notificationGrpcHandlers;
    notificationGrpcHealthCheck = mod.notificationGrpcHealthCheck;
  });

  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockResolvedValue({ rows: [{ email_enabled: true, sms_enabled: false, push_enabled: true }], rowCount: 1 });
  });

  function invokeGetPrefs(request: { user_id?: string }): Promise<{ err?: unknown; res?: unknown }> {
    return new Promise((resolve) => {
      notificationGrpcHandlers.GetUserPreferences({ request } as grpc.ServerUnaryCall<any, any>, (err, res) => {
        if (err) resolve({ err });
        else resolve({ res });
      });
    });
  }

  it("GetUserPreferences — INVALID_ARGUMENT without user_id", async () => {
    const { err } = await invokeGetPrefs({});
    expect((err as { code: number }).code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("GetUserPreferences — defaults when no row", async () => {
    poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { res } = await invokeGetPrefs({ user_id: userId });
    expect(res).toMatchObject({ email_enabled: true, sms_enabled: false, push_enabled: true });
  });

  it("GetUserPreferences — maps row", async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [{ email_enabled: false, sms_enabled: true, push_enabled: false }],
      rowCount: 1,
    });
    const { res } = await invokeGetPrefs({ user_id: userId });
    expect(res).toEqual({ email_enabled: false, sms_enabled: true, push_enabled: false });
  });

  it("GetUserPreferences — INTERNAL on query failure", async () => {
    poolQuery.mockRejectedValueOnce(new Error("timeout"));
    const { err } = await invokeGetPrefs({ user_id: userId });
    expect((err as { code: number }).code).toBe(grpc.status.INTERNAL);
  });

  it("notificationGrpcHealthCheck — true when SELECT 1 succeeds", async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 });
    await expect(notificationGrpcHealthCheck()).resolves.toBe(true);
  });

  it("notificationGrpcHealthCheck — false when SELECT 1 fails", async () => {
    poolQuery.mockRejectedValueOnce(new Error("down"));
    await expect(notificationGrpcHealthCheck()).resolves.toBe(false);
  });
});
