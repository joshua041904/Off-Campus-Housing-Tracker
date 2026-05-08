/**
 * Covers auth `startGrpcServer` with mocked grpc.Server + `@common/utils` creds/health hooks.
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

describe("auth grpc-server startGrpcServer bootstrap", () => {
  beforeEach(() => {
    credBind.mockReset();
    regHealth.mockReset();
    regHealth.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ENABLE_GRPC_REFLECTION;
  });

  it("bindAsync success wires services and completes callback", async () => {
    credBind.mockReturnValue({} as grpc.ServerCredentials);

    const addService = vi.fn();
    const bindAsync = vi.fn(
      (_host: string, _c: grpc.ServerCredentials, cb: (e: Error | null, p?: number) => void) => {
        cb(null, 50051);
      },
    );
    vi.spyOn(grpc, "Server").mockImplementation(() => ({ addService, bindAsync } as any));

    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(50051);

    expect(addService).toHaveBeenCalled();
    expect(bindAsync).toHaveBeenCalledWith(
      "0.0.0.0:50051",
      expect.anything(),
      expect.any(Function),
    );
  });

  it("bindAsync error invokes callback with error (no throw)", async () => {
    credBind.mockReturnValue({} as grpc.ServerCredentials);

    const addService = vi.fn();
    const bindAsync = vi.fn(
      (_host: string, _c: grpc.ServerCredentials, cb: (e: Error | null, p?: number) => void) => {
        cb(new Error("EADDRINUSE"));
      },
    );
    vi.spyOn(grpc, "Server").mockImplementation(() => ({ addService, bindAsync } as any));

    const { startGrpcServer } = await import("../src/grpc-server.js");
    expect(() => startGrpcServer(50051)).not.toThrow();
    expect(bindAsync).toHaveBeenCalled();
  });

  it("createOchGrpcServerCredentialsForBind throws → process.exit(1)", async () => {
    credBind.mockImplementation(() => {
      throw new Error("missing tls material");
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(grpc, "Server").mockImplementation(
      () => ({ addService: vi.fn(), bindAsync: vi.fn() } as any),
    );

    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(50051);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("ENABLE_GRPC_REFLECTION=false skips reflection block for that start call", async () => {
    process.env.ENABLE_GRPC_REFLECTION = "false";
    credBind.mockReturnValue({} as grpc.ServerCredentials);

    const addService = vi.fn();
    const bindAsync = vi.fn(
      (_h: string, _c: grpc.ServerCredentials, cb: (e: Error | null, p?: number) => void) => {
        cb(null, 50052);
      },
    );
    vi.spyOn(grpc, "Server").mockImplementation(() => ({ addService, bindAsync } as any));

    const { startGrpcServer } = await import("../src/grpc-server.js");
    expect(() => startGrpcServer(50052)).not.toThrow();
    expect(bindAsync).toHaveBeenCalled();
  });
});
