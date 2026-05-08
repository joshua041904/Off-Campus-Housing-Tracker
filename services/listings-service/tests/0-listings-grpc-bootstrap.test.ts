/**
 * Covers listings `startGrpcServer` / `startGrpcServerAndWait` with mocked grpc.Server + utils.
 */
import * as grpc from "@grpc/grpc-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const credBind = vi.hoisted(() => vi.fn());
const regHealth = vi.hoisted(() => vi.fn());

vi.mock("@common/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils")>();
  return {
    ...actual,
    createOchGrpcServerCredentialsForBind: (...args: unknown[]) =>
      credBind(...args),
    registerHealthService: (...args: unknown[]) => regHealth(...args),
  };
});

describe("listings grpc-server bootstrap", () => {
  beforeEach(() => {
    credBind.mockReset();
    regHealth.mockReset();
    regHealth.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("startGrpcServer calls bindAsync with credentials", async () => {
    credBind.mockReturnValue({} as grpc.ServerCredentials);

    const addService = vi.fn();
    const bindAsync = vi.fn(
      (_host: string, _c: grpc.ServerCredentials, cb: (e: Error | null, p?: number) => void) => {
        cb(null, 50061);
      },
    );
    vi.spyOn(grpc, "Server").mockImplementation(() => ({ addService, bindAsync } as any));

    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(50061);

    expect(addService).toHaveBeenCalled();
    expect(bindAsync).toHaveBeenCalledWith(
      "0.0.0.0:50061",
      expect.anything(),
      expect.any(Function),
    );
  });

  it("startGrpcServerAndWait rejects when bindAsync returns error", async () => {
    credBind.mockReturnValue({} as grpc.ServerCredentials);

    const bindAsync = vi.fn(
      (_host: string, _c: grpc.ServerCredentials, cb: (e: Error | null, p?: number) => void) => {
        cb(new Error("bind failed"));
      },
    );
    vi.spyOn(grpc, "Server").mockImplementation(
      () => ({ addService: vi.fn(), bindAsync } as any),
    );

    const { startGrpcServerAndWait } = await import("../src/grpc-server.js");
    await expect(startGrpcServerAndWait(50062)).rejects.toThrow("bind failed");
  });

  it("createOchGrpcServerCredentialsForBind throws → process.exit(1)", async () => {
    credBind.mockImplementation(() => {
      throw new Error("no cert");
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(grpc, "Server").mockImplementation(
      () => ({ addService: vi.fn(), bindAsync: vi.fn() } as any),
    );

    const { startGrpcServer } = await import("../src/grpc-server.js");
    expect(() => startGrpcServer(50063)).toThrow("no cert");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
