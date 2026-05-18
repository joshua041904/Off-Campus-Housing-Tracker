import { afterEach, describe, expect, it, vi } from "vitest";
import { getExternalDeliveryWarnings, getEmailDeliveryMode } from "../src/lib/delivery-modes.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getExternalDeliveryWarnings", () => {
  it("flags provider mode over Mailpit-style SMTP", () => {
    vi.stubEnv("EMAIL_DELIVERY_MODE", "provider");
    vi.stubEnv("SMTP_HOST", "host.docker.internal");
    vi.stubEnv("SMTP_PORT", "1025");
    expect(getEmailDeliveryMode()).toBe("provider");
    expect(getExternalDeliveryWarnings().some((w) => w.includes("email_mode_mismatch"))).toBe(true);
  });

  it("flags self_hosted_gateway without URL", () => {
    vi.stubEnv("SMS_DELIVERY_MODE", "self_hosted_gateway");
    vi.stubEnv("SMS_SELF_HOSTED_URL", "");
    expect(getExternalDeliveryWarnings().some((w) => w.includes("sms_mode_mismatch"))).toBe(true);
  });

  it("flags provider SMS without Twilio", () => {
    vi.stubEnv("SMS_DELIVERY_MODE", "provider");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    expect(getExternalDeliveryWarnings().some((w) => w.includes("sms_mode_mismatch"))).toBe(true);
  });
});
