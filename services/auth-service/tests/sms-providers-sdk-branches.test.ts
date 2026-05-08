/**
 * AWS / Vonage / MessageBird branches for `lib/sms-providers.ts`.
 * Vitest does not intercept raw `require()` for missing packages; we patch `Module.prototype.require`
 * for these ids only (worker is single-threaded per vitest.config).
 */
import module from "node:module";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const origRequire = module.Module.prototype.require;

type StubState = {
  awsPublish: () => Promise<{ MessageId: string }>;
  vonageSend: () => Promise<{
    messages: Array<{ status: string; "message-id"?: string; "error-text"?: string }>;
  }>;
  messagebirdCreate: () => Promise<{ id: string }>;
  awsRequireThrow: boolean;
  vonageRequireThrow: boolean;
  messagebirdRequireThrow: boolean;
};

const stubState: StubState = {
  awsPublish: async () => ({ MessageId: "stub-aws" }),
  vonageSend: async () => ({
    messages: [{ status: "0", "message-id": "von-ok" }],
  }),
  messagebirdCreate: async () => ({ id: "mb-ok" }),
  awsRequireThrow: false,
  vonageRequireThrow: false,
  messagebirdRequireThrow: false,
};

function patchedRequire(this: unknown, request: string, ...rest: unknown[]) {
  if (request === "aws-sdk") {
    if (stubState.awsRequireThrow) throw new Error("ENOENT");
    const SNS = class {
      publish() {
        return { promise: () => stubState.awsPublish() };
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_opts: unknown) {}
    };
    return { SNS, default: { SNS } };
  }
  if (request === "@vonage/server-sdk") {
    if (stubState.vonageRequireThrow) throw new Error("ENOENT");
    const Vonage = class {
      sms = { send: async () => stubState.vonageSend() };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_opts: unknown) {}
    };
    return { Vonage };
  }
  if (request === "messagebird") {
    if (stubState.messagebirdRequireThrow) throw new Error("ENOENT");
    return {
      initClient: () => ({
        messages: {
          create: async () => stubState.messagebirdCreate(),
        },
      }),
    };
  }
  return (origRequire as (req: string, ...r: unknown[]) => unknown).apply(this, [request, ...rest]);
}

describe("sms-providers SDK branches", () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origSmsMock = process.env.SMS_USE_MOCK;
  const origSmsProvider = process.env.SMS_PROVIDER;

  beforeAll(() => {
    module.Module.prototype.require = patchedRequire as typeof module.Module.prototype.require;
  });

  afterAll(() => {
    module.Module.prototype.require = origRequire;
  });

  beforeEach(() => {
    vi.resetModules();
    stubState.awsPublish = async () => ({ MessageId: "stub-aws" });
    stubState.vonageSend = async () => ({
      messages: [{ status: "0", "message-id": "von-ok" }],
    });
    stubState.messagebirdCreate = async () => ({ id: "mb-ok" });
    stubState.awsRequireThrow = false;
    stubState.vonageRequireThrow = false;
    stubState.messagebirdRequireThrow = false;
  });

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv ?? "test";
    if (origSmsMock === undefined) delete process.env.SMS_USE_MOCK;
    else process.env.SMS_USE_MOCK = origSmsMock;
    if (origSmsProvider === undefined) delete process.env.SMS_PROVIDER;
    else process.env.SMS_PROVIDER = origSmsProvider;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_REGION;
    delete process.env.VONAGE_API_KEY;
    delete process.env.VONAGE_API_SECRET;
    delete process.env.VONAGE_FROM_NUMBER;
    delete process.env.MESSAGEBIRD_API_KEY;
    delete process.env.MESSAGEBIRD_ORIGINATOR;
  });

  it("AWS SNS send success (patched require)", async () => {
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "aws-sns";
    process.env.AWS_ACCESS_KEY_ID = "AKIA";
    process.env.AWS_SECRET_ACCESS_KEY = "sec";
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    const p = createSmsProvider()!;
    const r = await p.sendSms("+12025550123", "body");
    expect(r.success).toBe(true);
    expect(r.messageId).toBe("stub-aws");
  });

  it("AWS SNS send failure maps to success false", async () => {
    stubState.awsPublish = async () => {
      throw new Error("sns throttle");
    };
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "aws-sns";
    process.env.AWS_ACCESS_KEY_ID = "AKIA";
    process.env.AWS_SECRET_ACCESS_KEY = "sec";
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    const p = createSmsProvider()!;
    const r = await p.sendSms("+1", "x");
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain("sns throttle");
  });

  it("AWS require failure surfaces as AwsSnsSmsProvider constructor error", async () => {
    stubState.awsRequireThrow = true;
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "aws-sns";
    process.env.AWS_ACCESS_KEY_ID = "AKIA";
    process.env.AWS_SECRET_ACCESS_KEY = "sec";
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    expect(() => createSmsProvider()).toThrow(/AWS SDK not installed/);
  });

  it("Vonage success returns message-id", async () => {
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "vonage";
    process.env.VONAGE_API_KEY = "k";
    process.env.VONAGE_API_SECRET = "s";
    process.env.VONAGE_FROM_NUMBER = "OCH";
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    const p = createSmsProvider()!;
    const r = await p.sendSms("+1", "hi");
    expect(r.success).toBe(true);
    expect(r.messageId).toBe("von-ok");
  });

  it("Vonage non-zero status maps to error", async () => {
    stubState.vonageSend = async () => ({
      messages: [{ status: "9", "error-text": "quota" }],
    });
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "vonage";
    process.env.VONAGE_API_KEY = "k";
    process.env.VONAGE_API_SECRET = "s";
    process.env.VONAGE_FROM_NUMBER = "OCH";
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    const p = createSmsProvider()!;
    const r = await p.sendSms("+1", "hi");
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain("quota");
  });

  it("Vonage send exception path", async () => {
    stubState.vonageSend = async () => {
      throw new Error("vonage net");
    };
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "vonage";
    process.env.VONAGE_API_KEY = "k";
    process.env.VONAGE_API_SECRET = "s";
    process.env.VONAGE_FROM_NUMBER = "OCH";
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    const p = createSmsProvider()!;
    const r = await p.sendSms("+1", "x");
    expect(r.success).toBe(false);
  });

  it("Vonage require failure surfaces as VonageSmsProvider constructor error", async () => {
    stubState.vonageRequireThrow = true;
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "vonage";
    process.env.VONAGE_API_KEY = "k";
    process.env.VONAGE_API_SECRET = "s";
    process.env.VONAGE_FROM_NUMBER = "OCH";
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    expect(() => createSmsProvider()).toThrow(/Vonage SDK not installed/);
  });

  it("MessageBird send success and failure", async () => {
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "messagebird";
    process.env.MESSAGEBIRD_API_KEY = "mbk";
    process.env.MESSAGEBIRD_ORIGINATOR = "OCH";
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    const p = createSmsProvider()!;
    expect(await p.sendSms("+1", "a")).toEqual(
      expect.objectContaining({ success: true, messageId: "mb-ok" }),
    );

    stubState.messagebirdCreate = async () => {
      throw new Error("mb down");
    };
    vi.resetModules();
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "messagebird";
    process.env.MESSAGEBIRD_API_KEY = "mbk";
    process.env.MESSAGEBIRD_ORIGINATOR = "OCH";
    const { createSmsProvider: c2 } = await import("../src/lib/sms-providers.js");
    const p2 = c2()!;
    const r2 = await p2.sendSms("+1", "b");
    expect(r2.success).toBe(false);
  });

  it("MessageBird require failure surfaces as MessageBirdSmsProvider constructor error", async () => {
    stubState.messagebirdRequireThrow = true;
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "messagebird";
    process.env.MESSAGEBIRD_API_KEY = "mbk";
    process.env.MESSAGEBIRD_ORIGINATOR = "OCH";
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    expect(() => createSmsProvider()).toThrow(/MessageBird package not installed/);
  });
});
