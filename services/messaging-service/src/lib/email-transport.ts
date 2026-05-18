import nodemailer from "nodemailer";
import { getEmailDeliveryMode, smtpHostConfigured, type EmailDeliveryMode } from "./delivery-modes.js";

function getEmailTransporter(): nodemailer.Transporter | null {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASSWORD;
  if (!smtpHost) return null;
  const transportConfig: Record<string, unknown> = {
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
  };
  if (smtpUser && smtpPass) {
    transportConfig.auth = { user: smtpUser, pass: smtpPass };
  }
  return nodemailer.createTransport(transportConfig);
}

export type SendEmailResult =
  | { ok: true; messageId?: string; email_delivery_mode: EmailDeliveryMode }
  | { ok: false; error: string };

/**
 * Single SMTP send path: Mailpit, self-hosted Postfix, or SaaS relay — all use the same authenticated SMTP hop.
 * Mode only affects product copy and capabilities (SPF/DKIM expectations differ by deployment).
 */
export async function sendExternalEmail(params: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<SendEmailResult> {
  const mode = getEmailDeliveryMode();
  if (mode === "unconfigured") {
    return {
      ok: false,
      error:
        "Email delivery mode is unconfigured. Set EMAIL_DELIVERY_MODE (test_sink | self_hosted_smtp | provider) and SMTP_HOST / credentials.",
    };
  }
  if (!smtpHostConfigured()) {
    return { ok: false, error: "Email transport unconfigured (set SMTP_HOST and usually SMTP_FROM or SMTP_USER)." };
  }
  const transporter = getEmailTransporter();
  if (!transporter) {
    return { ok: false, error: "Could not build SMTP transporter." };
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@off-campus-housing.test";
  try {
    const info = await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject || "Message from Off-Campus Housing",
      text: params.text,
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    });
    const messageId =
      typeof info?.messageId === "string" ? info.messageId : (info as { messageId?: string })?.messageId;
    return { ok: true, messageId: messageId || undefined, email_delivery_mode: mode };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export { getEmailDeliveryMode, smtpHostConfigured as smtpConfigured };
