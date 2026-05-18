import { afterEach, describe, expect, it, vi } from "vitest";
import { getEmailDeliveryMode, getSmsDeliveryMode } from "../src/lib/delivery-modes.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("delivery-modes", () => {
  it("email is unconfigured when SMTP_HOST is empty", () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("EMAIL_DELIVERY_MODE", "");
    expect(getEmailDeliveryMode()).toBe("unconfigured");
  });

  it("email auto infers test_sink for mailpit-style port", () => {
    vi.stubEnv("SMTP_HOST", "host.docker.internal");
    vi.stubEnv("SMTP_PORT", "1025");
    vi.stubEnv("EMAIL_DELIVERY_MODE", "auto");
    expect(getEmailDeliveryMode()).toBe("test_sink");
  });

  it("email auto infers self_hosted_smtp for normal relay port", () => {
    vi.stubEnv("SMTP_HOST", "smtp.internal.example");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("EMAIL_DELIVERY_MODE", "auto");
    expect(getEmailDeliveryMode()).toBe("self_hosted_smtp");
  });

  it("sms respects SMS_DELIVERY_MODE=mock", () => {
    vi.stubEnv("SMS_DELIVERY_MODE", "mock");
    expect(getSmsDeliveryMode()).toBe("mock");
  });

  it("sms explicit unconfigured", () => {
    vi.stubEnv("SMS_DELIVERY_MODE", "unconfigured");
    expect(getSmsDeliveryMode()).toBe("unconfigured");
  });
});
