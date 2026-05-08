/**
 * Covers `server.ts` HTTP listen branch (normally skipped when VITEST=true).
 * Uses http.Server.prototype.listen mock so no real port bind.
 */
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("server.ts HTTP listen bootstrap", () => {
  const listenSpy = vi.spyOn(http.Server.prototype, "listen");

  beforeAll(() => {
    listenSpy.mockImplementation(function listenNoop(this: http.Server, ...args: unknown[]) {
      const cb = args.find((a) => typeof a === "function") as (() => void) | undefined;
      if (cb) queueMicrotask(() => cb.call(this));
      return this as unknown as http.Server;
    });
    process.env.AUTH_FORCE_LISTEN_IN_TEST = "1";
    process.env.ENABLE_GRPC = "false";
    process.env.AUTH_OUTBOX_PUBLISHER = "0";
  });

  afterAll(async () => {
    listenSpy.mockRestore();
    delete process.env.AUTH_FORCE_LISTEN_IN_TEST;
    delete process.env.ENABLE_GRPC;
    delete process.env.AUTH_OUTBOX_PUBLISHER;
    vi.resetModules();
    await import("../src/server");
  });

  it(
    "invokes app.listen when AUTH_FORCE_LISTEN_IN_TEST=1 under Vitest",
    async () => {
      vi.resetModules();
      await import("../src/server");
      expect(listenSpy).toHaveBeenCalled();
    },
    // Full server module pulls Prisma/Redis/bootstrap; default 5s is flaky on loaded CI / cold caches.
    30_000,
  );
});
