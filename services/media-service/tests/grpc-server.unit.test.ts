/**
 * Unit coverage for `src/grpc-server.ts` (mock @grpc/grpc-js + handlers; no real bind).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const grpcHoisted = vi.hoisted(() => {
  const bindAsync = vi.fn(
    (_host: string, _creds: unknown, cb: (err: Error | null, port?: number) => void) => {
      queueMicrotask(() => cb(null, 50_051));
    },
  );
  const Server = vi.fn(function ServerMock(this: {
    addService: ReturnType<typeof vi.fn>;
    bindAsync: typeof bindAsync;
  }) {
    this.addService = vi.fn();
    this.bindAsync = bindAsync;
  });
  const loadPackageDefinition = vi.fn(() => ({
    media: { MediaService: { service: {} } },
  }));
  return { Server, bindAsync, loadPackageDefinition };
});

vi.mock("@grpc/grpc-js", () => ({
  Server: grpcHoisted.Server,
  loadPackageDefinition: grpcHoisted.loadPackageDefinition,
  status: { INVALID_ARGUMENT: 3, INTERNAL: 13, NOT_FOUND: 5 },
}));

vi.mock("@grpc/proto-loader", () => ({
  loadSync: vi.fn(() => ({})),
}));

vi.mock("@common/utils/proto", () => ({
  resolveProtoPath: vi.fn(() => "/fake/media.proto"),
}));

vi.mock("@common/utils/grpc-health", () => ({
  registerHealthService: vi.fn(),
}));

vi.mock("@common/utils/grpc-server-credentials", () => ({
  createOchGrpcServerCredentialsForBind: vi.fn(() => ({})),
}));

const handlers = vi.hoisted(() => ({
  createUploadUrl: vi.fn().mockResolvedValue({
    mediaId: "mid-1",
    uploadUrl: "https://upload.example/presign",
    objectKey: "objects/k1",
    expiresAt: 1_700_000_000,
  }),
  completeUpload: vi.fn().mockResolvedValue(true),
  getDownloadUrl: vi.fn().mockResolvedValue({
    downloadUrl: "https://cdn.example/get",
    expiresAt: 1_700_000_100,
  }),
}));

vi.mock("../src/handlers/createUploadUrl.js", () => ({
  createUploadUrl: handlers.createUploadUrl,
}));
vi.mock("../src/handlers/completeUpload.js", () => ({
  completeUpload: handlers.completeUpload,
}));
vi.mock("../src/handlers/getDownloadUrl.js", () => ({
  getDownloadUrl: handlers.getDownloadUrl,
}));

vi.mock("../src/db/mediaRepo.js", () => ({
  checkConnection: vi.fn().mockResolvedValue(true),
}));

describe("media grpc-server", () => {
  beforeEach(() => {
    vi.resetModules();
    grpcHoisted.Server.mockClear();
    grpcHoisted.bindAsync.mockImplementation(
      (_host: string, _creds: unknown, cb: (err: Error | null, port?: number) => void) => {
        queueMicrotask(() => cb(null, 50_051));
      },
    );
    handlers.createUploadUrl.mockReset();
    handlers.createUploadUrl.mockResolvedValue({
      mediaId: "mid-1",
      uploadUrl: "https://upload.example/presign",
      objectKey: "objects/k1",
      expiresAt: 1_700_000_000,
    });
    handlers.completeUpload.mockReset();
    handlers.completeUpload.mockResolvedValue(true);
    handlers.getDownloadUrl.mockReset();
    handlers.getDownloadUrl.mockResolvedValue({
      downloadUrl: "https://cdn.example/get",
      expiresAt: 1_700_000_100,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getServiceImpl(): {
    CreateUploadUrl: (call: { request: Record<string, unknown> }, cb: (e: unknown, r?: unknown) => void) => void;
    CompleteUpload: (call: { request: { media_id: string } }, cb: (e: unknown, r?: unknown) => void) => void;
    GetDownloadUrl: (call: { request: { media_id: string } }, cb: (e: unknown, r?: unknown) => void) => void;
  } {
    const inst = grpcHoisted.Server.mock.results.at(-1)?.value as
      | { addService: ReturnType<typeof vi.fn> }
      | undefined;
    expect(inst?.addService).toBeDefined();
    const impl = inst!.addService.mock.calls[0]![1] as ReturnType<typeof getServiceImpl>;
    return impl;
  }

  it("startGrpcServer registers service and binds", async () => {
    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(9010);
    expect(grpcHoisted.Server).toHaveBeenCalled();
    expect(grpcHoisted.bindAsync).toHaveBeenCalled();
    const impl = getServiceImpl();
    await new Promise<void>((resolve, reject) => {
      impl.CreateUploadUrl(
        {
          request: {
            user_id: "user-1",
            filename: "a.png",
            content_type: "image/png",
            size_bytes: 1024,
          },
        },
        (err, res) => {
          if (err) reject(err);
          else {
            expect(res).toMatchObject({
              media_id: "mid-1",
              upload_url: "https://upload.example/presign",
              object_key: "objects/k1",
            });
            resolve();
          }
        },
      );
    });
  });

  it("CreateUploadUrl maps INVALID_FILE_TYPE to INVALID_ARGUMENT", async () => {
    handlers.createUploadUrl.mockRejectedValueOnce(new Error("INVALID_FILE_TYPE"));
    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(9011);
    const impl = getServiceImpl();
    await new Promise<void>((resolve) => {
      impl.CreateUploadUrl(
        { request: { user_id: "u", filename: "x", content_type: "bad/ct", size_bytes: 1 } },
        (err: { code?: number } | null) => {
          expect(err?.code).toBe(3);
          resolve();
        },
      );
    });
  });

  it("GetDownloadUrl returns NOT_FOUND when handler returns null", async () => {
    handlers.getDownloadUrl.mockResolvedValueOnce(null);
    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(9012);
    const impl = getServiceImpl();
    await new Promise<void>((resolve) => {
      impl.GetDownloadUrl({ request: { media_id: "missing" } }, (err: { code?: number } | null) => {
        expect(err?.code).toBe(5);
        resolve();
      });
    });
  });

  it("CompleteUpload maps unexpected errors to INTERNAL", async () => {
    handlers.completeUpload.mockRejectedValueOnce(new Error("db down"));
    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(9013);
    const impl = getServiceImpl();
    await new Promise<void>((resolve) => {
      impl.CompleteUpload({ request: { media_id: "m1" } }, (err: { code?: number } | null) => {
        expect(err?.code).toBe(13);
        resolve();
      });
    });
  });

  it("bindAsync error invokes process.exit(1)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    grpcHoisted.bindAsync.mockImplementationOnce(
      (_h: string, _c: unknown, cb: (err: Error | null, p?: number) => void) => {
        queueMicrotask(() => cb(new Error("bind failed")));
      },
    );
    const { startGrpcServer } = await import("../src/grpc-server.js");
    startGrpcServer(9014);
    await new Promise<void>((r) => setImmediate(r));
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
