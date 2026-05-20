import {
  getSmsDeliveryMode,
  type SmsDeliveryMode,
} from "./delivery-modes.js";

export type SendSmsResult =
  | { ok: true; messageId?: string; sms_delivery_mode: SmsDeliveryMode; dev_mock?: boolean }
  | { ok: false; error: string; sms_delivery_mode?: SmsDeliveryMode };

/** Twilio REST without the twilio npm package. */
async function sendTwilio(to: string, body: string): Promise<SendSmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    return {
      ok: false,
      error:
        "Twilio provider not fully configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER).",
      sms_delivery_mode: "provider",
    };
  }
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: params,
    });
    const j = (await r.json().catch(() => ({}))) as { message?: string; sid?: string; code?: number };
    if (!r.ok) {
      return { ok: false, error: String(j.message || `twilio_http_${r.status}`), sms_delivery_mode: "provider" };
    }
    return { ok: true, messageId: j.sid || undefined, sms_delivery_mode: "provider" };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), sms_delivery_mode: "provider" };
  }
}

/**
 * Pluggable self-hosted gateway: HTTP POST JSON to operator-controlled endpoint (modem pool, SMPP bridge, etc.).
 * Body: { to, body } — extend when you add signed webhooks.
 */
async function sendSelfHostedGateway(to: string, body: string): Promise<SendSmsResult> {
  const url = process.env.SMS_SELF_HOSTED_URL?.trim();
  if (!url) {
    return {
      ok: false,
      error: "SMS_DELIVERY_MODE is self_hosted_gateway but SMS_SELF_HOSTED_URL is not set.",
      sms_delivery_mode: "self_hosted_gateway",
    };
  }
  const token = process.env.SMS_SELF_HOSTED_TOKEN?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ to, body }),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; message_id?: string; error?: string };
    if (!r.ok) {
      return {
        ok: false,
        error: String(j.error || `gateway_http_${r.status}`),
        sms_delivery_mode: "self_hosted_gateway",
      };
    }
    const messageId = typeof j.id === "string" ? j.id : typeof j.message_id === "string" ? j.message_id : undefined;
    return { ok: true, messageId, sms_delivery_mode: "self_hosted_gateway" };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      sms_delivery_mode: "self_hosted_gateway",
    };
  }
}

function sendMock(to: string, body: string): SendSmsResult {
  const id = `mock-sms-${Date.now()}`;
  console.log(`[external-sms:mock] to=${to} id=${id} chars=${body.length} (not delivered to handset)`);
  return { ok: true, messageId: id, sms_delivery_mode: "mock", dev_mock: true };
}

/**
 * Dispatch by explicit SMS_DELIVERY_MODE (see delivery-modes.ts).
 * Does not claim carrier delivery in mock mode.
 */
export async function sendExternalSms(to: string, body: string): Promise<SendSmsResult> {
  const mode = getSmsDeliveryMode();
  switch (mode) {
    case "unconfigured":
      return {
        ok: false,
        error:
          "SMS transport unconfigured. Set SMS_DELIVERY_MODE and matching credentials (Twilio, or SMS_SELF_HOSTED_URL, or mock for dev).",
        sms_delivery_mode: "unconfigured",
      };
    case "mock":
      return sendMock(to, body);
    case "self_hosted_gateway":
      return sendSelfHostedGateway(to, body);
    case "provider":
      return sendTwilio(to, body);
  }
}
