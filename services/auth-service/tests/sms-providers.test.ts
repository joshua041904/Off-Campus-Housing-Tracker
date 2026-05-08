/**
 * Unit coverage for `lib/sms-providers.ts` (mock + Twilio). AWS/Vonage/MessageBird: `sms-providers-sdk-branches.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("sms-providers", () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origSmsMock = process.env.SMS_USE_MOCK;
  const origSmsProvider = process.env.SMS_PROVIDER;
  const origTwilioSid = process.env.TWILIO_ACCOUNT_SID;
  const origTwilioToken = process.env.TWILIO_AUTH_TOKEN;
  const origTwilioFrom = process.env.TWILIO_FROM_NUMBER;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv ?? "test";
    if (origSmsMock === undefined) delete process.env.SMS_USE_MOCK;
    else process.env.SMS_USE_MOCK = origSmsMock;
    if (origSmsProvider === undefined) delete process.env.SMS_PROVIDER;
    else process.env.SMS_PROVIDER = origSmsProvider;
    if (origTwilioSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = origTwilioSid;
    if (origTwilioToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = origTwilioToken;
    if (origTwilioFrom === undefined) delete process.env.TWILIO_FROM_NUMBER;
    else process.env.TWILIO_FROM_NUMBER = origTwilioFrom;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_REGION;
    delete process.env.VONAGE_API_KEY;
    delete process.env.VONAGE_API_SECRET;
    delete process.env.VONAGE_FROM_NUMBER;
    delete process.env.MESSAGEBIRD_API_KEY;
    delete process.env.MESSAGEBIRD_ORIGINATOR;
  });

  it("MockSmsProvider sends and extracts 6-digit code", async () => {
    const { MockSmsProvider } = await import("../src/lib/sms-providers.js");
    const m = new MockSmsProvider();
    const r = await m.sendSms("+15550001111", "Your code is 654321");
    expect(r.success).toBe(true);
    expect(r.messageId).toMatch(/^mock-/);
    const msgs = m.getMessages();
    expect(msgs[0]?.code).toBe("654321");
    m.clearMessages();
    expect(m.getMessages()).toHaveLength(0);
    expect(m.getName()).toContain("Mock");
  });

  it("MockSmsProvider handles message without standard code pattern", async () => {
    const { MockSmsProvider } = await import("../src/lib/sms-providers.js");
    const m = new MockSmsProvider();
    await m.sendSms("+1", "no code here");
    const msgs = m.getMessages();
    expect(msgs[0]?.code).toBeUndefined();
  });

  it("createSmsProvider returns mock under NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    const p = createSmsProvider();
    expect(p?.getName()).toContain("Mock");
    const r = await p!.sendSms("+1", "code: 111222");
    expect(r.success).toBe(true);
  });

  it("getMockSmsProvider returns singleton", async () => {
    const { getMockSmsProvider } = await import("../src/lib/sms-providers.js");
    const a = getMockSmsProvider();
    const b = getMockSmsProvider();
    expect(a).toBe(b);
  });

  it("createSmsProvider uses Twilio client and maps API failure to { success: false }", async () => {
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "AC_test_invalid";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+15551234567";
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    const p = createSmsProvider();
    expect(p?.getName()).toBe("Twilio");
    const r = await p!.sendSms("+15559876543", "hello");
    expect(r.success).toBe(false);
    expect(String(r.error || "").length).toBeGreaterThan(0);
  });

  it("falls back to mock when Twilio creds incomplete", async () => {
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "auto";
    delete process.env.TWILIO_ACCOUNT_SID;
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    const p = createSmsProvider();
    expect(p?.getName()).toContain("Mock");
  });

  it("createSmsProvider uses explicit SMS_PROVIDER=mock when not in test env", async () => {
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "mock";
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    const p = createSmsProvider();
    expect(p?.getName()).toContain("Mock");
  });

  it("createSmsProvider falls back to mock for unknown SMS_PROVIDER", async () => {
    process.env.NODE_ENV = "development";
    process.env.SMS_USE_MOCK = "false";
    process.env.SMS_PROVIDER = "not-a-real-provider";
    delete process.env.TWILIO_ACCOUNT_SID;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { createSmsProvider } = await import("../src/lib/sms-providers.js");
    const p = createSmsProvider();
    expect(p?.getName()).toContain("Mock");
    expect(warn).toHaveBeenCalled();
  });

});
