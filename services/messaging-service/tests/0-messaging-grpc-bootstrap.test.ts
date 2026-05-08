/**
 * Phase III: messaging `startGrpcServer` bootstrap (bind success/error, credentials → process.exit).
 * Skips registering SIGTERM (Vitest teardown can emit SIGTERM; mock Server has no forceShutdown).
 */
import * as grpc from "@grpc/grpc-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const origProcessOn = process.on.bind(process);

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

describe("messaging grpc-server bootstrap", () => {
  beforeAll(() => {
    vi.spyOn(process, "on").mockImplementation(((ev: string, listener: (...a: unknown[]) => void) => {
      if (ev === "SIGTERM") return process;
      return origProcessOn(ev as "beforeExit", listener as () => void);
    }) as typeof process.on);
  });

  afterAll(() => {
    vi.mocked(process.on).mockRestore();
  });

  beforeEach(() => {
    credBind.mockReset();
    regHealth.mockReset();
    regHealth.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(process, "on").mockImplementation(((ev: string, listener: (...a: unknown[]) => void) => {
      if (ev === "SIGTERM") return process;
      return origProcessOn(ev as "beforeExit", listener as () => void);
    }) as typeof process.on);
  });

  it("startGrpcServer calls bindAsync on success", async () => {
    credBind.mockReturnValue({} as grpc.ServerCredentials);
    const addService = vi.fn();
    const bindAsync = vi.fn(
      (_host: string, _c: grpc.ServerCredentials, cb: (e: Error | null, p?: number) => void) => {
        queueMicrotask(() => cb(null, 50_064));
      },
    );
    vi.spyOn(grpc, "Server").mockImplementation(() => ({ addService, bindAsync } as any));

    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(50_064);

    expect(addService).toHaveBeenCalled();
    expect(bindAsync).toHaveBeenCalledWith(
      "0.0.0.0:50064",
      expect.anything(),
      expect.any(Function),
    );
  });

  it("bindAsync error logs and returns", async () => {
    credBind.mockReturnValue({} as grpc.ServerCredentials);
    const bindAsync = vi.fn(
      (_host: string, _c: grpc.ServerCredentials, cb: (e: Error | null, p?: number) => void) => {
        queueMicrotask(() => cb(new Error("bind fail")));
      },
    );
    vi.spyOn(grpc, "Server").mockImplementation(
      () => ({ addService: vi.fn(), bindAsync } as any),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(50_172);
    await new Promise<void>((r) => setImmediate(r));

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("createOchGrpcServerCredentialsForBind throws → process.exit(1)", async () => {
    credBind.mockImplementation(() => {
      throw new Error("no server creds");
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(grpc, "Server").mockImplementation(
      () => ({ addService: vi.fn(), bindAsync: vi.fn() } as any),
    );

    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(50_173);
    await new Promise<void>((r) => setImmediate(r));

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
