/**
 * Phase III: notification `startGrpcServer` bootstrap (bind success/error, credentials → process.exit).
 */
import * as grpc from "@grpc/grpc-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const credBind = vi.hoisted(() => vi.fn());
const regHealth = vi.hoisted(() => vi.fn());

vi.mock("@common/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils")>();
  return {
    ...actual,
    createOchGrpcServerCredentialsForBind: (...args: unknown[]) => credBind(...args),
    registerHealthService: (...args: unknown[]) => regHealth(...args),
  };
});

describe("notification grpc-server bootstrap", () => {
  beforeEach(() => {
    credBind.mockReset();
    regHealth.mockReset();
    regHealth.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("startGrpcServer calls bindAsync on success", async () => {
    credBind.mockReturnValue({} as grpc.ServerCredentials);
    const addService = vi.fn();
    const bindAsync = vi.fn(
      (_host: string, _c: grpc.ServerCredentials, cb: (e: Error | null, p?: number) => void) => {
        queueMicrotask(() => cb(null, 50_065));
      },
    );
    vi.spyOn(grpc, "Server").mockImplementation(() => ({ addService, bindAsync } as any));

    const { startGrpcServer } = await import("../src/grpc-server.js");
    const srv = startGrpcServer(50_065);
    expect(srv).toBeDefined();

    expect(addService).toHaveBeenCalled();
    expect(bindAsync).toHaveBeenCalledWith(
      "0.0.0.0:50065",
      expect.anything(),
      expect.any(Function),
    );
  });

  it("bindAsync error logs and returns", async () => {
    credBind.mockReturnValue({} as grpc.ServerCredentials);
    const bindAsync = vi.fn(
      (_host: string, _c: grpc.ServerCredentials, cb: (e: Error | null, p?: number) => void) => {
        queueMicrotask(() => cb(new Error("eaddrinuse")));
      },
    );
    vi.spyOn(grpc, "Server").mockImplementation(
      () => ({ addService: vi.fn(), bindAsync } as any),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(50_170);
    await new Promise<void>((r) => setImmediate(r));

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("createOchGrpcServerCredentialsForBind throws → process.exit(1)", async () => {
    credBind.mockImplementation(() => {
      throw new Error("tls");
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(grpc, "Server").mockImplementation(
      () => ({ addService: vi.fn(), bindAsync: vi.fn() } as any),
    );

    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(50_171);
    await new Promise<void>((r) => setImmediate(r));

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
