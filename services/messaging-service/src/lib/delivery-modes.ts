/**
 * Explicit transport semantics for external email/SMS (no vague booleans).
 * Capabilities + send paths use these enums only.
 */

export type EmailDeliveryMode = "unconfigured" | "test_sink" | "self_hosted_smtp" | "provider";

export type SmsDeliveryMode = "unconfigured" | "mock" | "self_hosted_gateway" | "provider";

export function smtpHostConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim());
}

export function smtpLooksLikeTestSink(): boolean {
  const smtpHost = (process.env.SMTP_HOST || "").toLowerCase();
  const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
  return smtpPort === 1025 || smtpHost.includes("mailpit") || smtpHost.includes("mailhog");
}

/** Primary: EMAIL_DELIVERY_MODE; legacy: OCH_SMTP_DELIVERY_MODE, SMTP_DELIVERY_MODE */
export function getEmailDeliveryMode(): EmailDeliveryMode {
  const raw = (
    process.env.EMAIL_DELIVERY_MODE ||
    process.env.OCH_SMTP_DELIVERY_MODE ||
    process.env.SMTP_DELIVERY_MODE ||
    ""
  )
    .trim()
    .toLowerCase();

  if (raw === "unconfigured") return "unconfigured";
  if (!smtpHostConfigured()) return "unconfigured";
  if (raw === "test_sink" || raw === "mailpit" || raw === "dev_sink" || raw === "dev" || raw === "development")
    return "test_sink";
  if (
    raw === "self_hosted_smtp" ||
    raw === "self_hosted" ||
    raw === "postfix" ||
    raw === "exim" ||
    raw === "haraka" ||
    raw === "mailu" ||
    raw === "owned_relay"
  )
    return "self_hosted_smtp";
  if (raw === "provider" || raw === "relay" || raw === "production" || raw === "saas" || raw === "sendgrid" || raw === "ses")
    return "provider";
  if (raw === "auto" || raw === "") {
    return smtpLooksLikeTestSink() ? "test_sink" : "self_hosted_smtp";
  }
  return smtpLooksLikeTestSink() ? "test_sink" : "self_hosted_smtp";
}

function smsSelfHostedConfigured(): boolean {
  return Boolean(process.env.SMS_SELF_HOSTED_URL?.trim());
}

function smsTwilioConfigured(): boolean {
  const sid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const from = (process.env.TWILIO_FROM_NUMBER || "").trim();
  return Boolean(sid && token && from);
}

function smsExplicitMock(): boolean {
  return process.env.SMS_USE_MOCK === "true" || process.env.SMS_PROVIDER === "mock";
}

/** Primary: SMS_DELIVERY_MODE; infer from env when unset */
export function getSmsDeliveryMode(): SmsDeliveryMode {
  const raw = (process.env.SMS_DELIVERY_MODE || "").trim().toLowerCase();
  if (raw === "unconfigured") return "unconfigured";
  if (raw === "mock" || raw === "dev") return "mock";
  if (raw === "self_hosted_gateway" || raw === "self_hosted" || raw === "gateway" || raw === "smpp") {
    return "self_hosted_gateway";
  }
  if (raw === "provider" || raw === "twilio") {
    return "provider";
  }
  if (raw === "auto" || raw === "") {
    if (smsExplicitMock()) return "mock";
    if (smsSelfHostedConfigured()) return "self_hosted_gateway";
    if (smsTwilioConfigured()) return "provider";
    return "unconfigured";
  }
  if (smsExplicitMock()) return "mock";
  if (smsSelfHostedConfigured()) return "self_hosted_gateway";
  if (smsTwilioConfigured()) return "provider";
  return "unconfigured";
}

/** True when the service will attempt an outbound SMS (including dev mock). */
export function smsOutboundAttemptConfigured(): boolean {
  const m = getSmsDeliveryMode();
  return m === "mock" || m === "self_hosted_gateway" || m === "provider";
}

/** True when SMS would hit real carrier or self-hosted gateway (not mock). */
export function smsRealTransportConfigured(): boolean {
  const m = getSmsDeliveryMode();
  return m === "self_hosted_gateway" || m === "provider";
}

/**
 * Non-secret hints when declared modes disagree with actual credentials / SMTP shape.
 * Shown on GET …/external-contact/capabilities so the UI never stale-writes “real send” over a dev sink.
 */
export function getExternalDeliveryWarnings(): string[] {
  const w: string[] = [];
  const emailMode = getEmailDeliveryMode();
  if (smtpHostConfigured() && smtpLooksLikeTestSink() && (emailMode === "self_hosted_smtp" || emailMode === "provider")) {
    w.push(
      "email_mode_mismatch: SMTP host/port look like a dev sink (Mailpit/MailHog/port 1025) but EMAIL_DELIVERY_MODE claims real delivery — mail will not reach an outside inbox until SMTP_* point at a real relay.",
    );
  }
  const smsMode = getSmsDeliveryMode();
  if (smsMode === "self_hosted_gateway" && !smsSelfHostedConfigured()) {
    w.push(
      "sms_mode_mismatch: SMS_DELIVERY_MODE is self_hosted_gateway but SMS_SELF_HOSTED_URL is empty — outbound SMS will fail until the gateway URL is set.",
    );
  }
  if (smsMode === "provider" && !smsTwilioConfigured()) {
    w.push(
      "sms_mode_mismatch: SMS_DELIVERY_MODE is provider but Twilio env is incomplete — outbound SMS will fail until TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER are set.",
    );
  }
  return w;
}
