/**
 * External contact delivery: explicit modes + transport entrypoints.
 * Implementations live in email-transport.ts / sms-transport.ts / delivery-modes.ts.
 */

export type { EmailDeliveryMode, SmsDeliveryMode } from "./delivery-modes.js";
export {
  getEmailDeliveryMode,
  getSmsDeliveryMode,
  getExternalDeliveryWarnings,
  smtpHostConfigured,
  smsOutboundAttemptConfigured,
  smsRealTransportConfigured,
} from "./delivery-modes.js";
export { sendExternalEmail, type SendEmailResult } from "./email-transport.js";
export { sendExternalSms, type SendSmsResult } from "./sms-transport.js";

import {
  getEmailDeliveryMode,
  getExternalDeliveryWarnings,
  getSmsDeliveryMode,
  smtpHostConfigured,
  type EmailDeliveryMode,
  type SmsDeliveryMode,
} from "./delivery-modes.js";

/** @deprecated use smtpHostConfigured */
export const smtpConfigured = smtpHostConfigured;

/** Exposed to the webapp for honest external-contact UX (no secret values). */
export type ExternalContactCapabilities = {
  email_smtp_configured: boolean;
  /** True only for Mailpit-style capture (dev/test). */
  email_test_sink: boolean;
  email_delivery_mode: EmailDeliveryMode;
  /** Explicit SMS transport mode. */
  sms_delivery_mode: SmsDeliveryMode;
  /** @deprecated use sms_delivery_mode */
  sms_mode: "twilio_live" | "mock" | "self_hosted_gateway" | "unavailable";
  /** Mode vs transport mismatch hints (no secrets). */
  delivery_warnings: string[];
};

export function getExternalContactCapabilities(): ExternalContactCapabilities {
  const email_delivery_mode = getEmailDeliveryMode();
  const email_test_sink = email_delivery_mode === "test_sink";
  const email_smtp = smtpHostConfigured();
  const sms_delivery_mode = getSmsDeliveryMode();
  let sms_mode: ExternalContactCapabilities["sms_mode"];
  if (sms_delivery_mode === "mock") sms_mode = "mock";
  else if (sms_delivery_mode === "provider") sms_mode = "twilio_live";
  else if (sms_delivery_mode === "self_hosted_gateway") sms_mode = "self_hosted_gateway";
  else sms_mode = "unavailable";

  return {
    email_smtp_configured: email_smtp,
    email_test_sink,
    email_delivery_mode,
    sms_delivery_mode,
    sms_mode,
    delivery_warnings: getExternalDeliveryWarnings(),
  };
}

/** Legacy response tag for SMS POST (prefer sms_delivery_mode on the same response). */
export function smsOutboundDeliveryLabel(): "mock" | "twilio" | "self_hosted_gateway" {
  const m = getSmsDeliveryMode();
  if (m === "mock") return "mock";
  if (m === "self_hosted_gateway") return "self_hosted_gateway";
  return "twilio";
}

/** @deprecated use sendExternalSms */
export { sendExternalSms as sendExternalSmsTwilio } from "./sms-transport.js";
