import { kafka, ochKafkaTopicIsolationSuffix } from "@common/utils/kafka";
import type { Consumer } from "kafkajs";
import { pool } from "./lib/db.js";

const BOOKING_EVENTS_TOPIC =
  process.env.BOOKING_EVENTS_TOPIC || `dev.booking.events.v1${ochKafkaTopicIsolationSuffix()}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function fetchListingTitle(listingId: string): Promise<string> {
  const base = (process.env.LISTINGS_HTTP || "http://127.0.0.1:4012").replace(/\/$/, "");
  const url = `${base}/listings/${listingId}`;
  try {
    const ms = Number(process.env.MESSAGING_LISTING_FETCH_TIMEOUT_MS ?? "12000");
    const timeout = Number.isFinite(ms) ? Math.min(120_000, Math.max(1000, ms)) : 12_000;
    const upstream = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (upstream.status === 404) return "this listing";
    if (!upstream.ok) return "this listing";
    const j = (await upstream.json()) as Record<string, unknown>;
    const title = String(j.title ?? "Listing").trim();
    return title ? title.slice(0, 200) : "this listing";
  } catch {
    return "this listing";
  }
}

/** Idempotent: one confirmation notice per booking thread. */
export async function ensureBookingConfirmedLandlordMessage(payload: Record<string, unknown>): Promise<void> {
  const bookingId = String(payload.booking_id ?? "").trim();
  const listingId = String(payload.listing_id ?? "").trim();
  const landlordId = String(payload.landlord_id ?? "").trim();
  const tenantId = String(payload.tenant_id ?? "").trim();
  if (!UUID_RE.test(bookingId) || !UUID_RE.test(listingId) || !UUID_RE.test(landlordId) || !UUID_RE.test(tenantId)) {
    return;
  }

  const { rows: dup } = await pool.query(
    `SELECT 1 FROM messages.messages
     WHERE thread_id = $1::uuid AND message_type = 'BookingConfirmedNotice' LIMIT 1`,
    [bookingId],
  );
  if (dup.length > 0) return;

  const title = await fetchListingTitle(listingId);
  const subject = `[listing:${listingId}] Booking confirmed: ${title}`.slice(0, 500);
  const content = `The tenant confirmed this booking for “${title}”. You can continue coordinating here.`;

  await pool.query(
    `INSERT INTO messages.messages (
       sender_id, recipient_id, group_id, parent_message_id,
       thread_id, message_type, subject, content, is_read
     ) VALUES ($1::uuid, $2::uuid, NULL, NULL, $3::uuid, $4, $5, $6, FALSE)`,
    [tenantId, landlordId, bookingId, "BookingConfirmedNotice", subject, content],
  );
  console.info("[messaging] booking confirmed notice inserted", { booking_id: bookingId, listing_id: listingId });
}

/** Idempotent: one seed row per booking thread (thread_id = booking_id). */
export async function ensureBookingChatThread(payload: Record<string, unknown>): Promise<void> {
  const bookingId = String(payload.booking_id ?? "").trim();
  const listingId = String(payload.listing_id ?? "").trim();
  const landlordId = String(payload.landlord_id ?? "").trim();
  const tenantId = String(payload.tenant_id ?? "").trim();
  if (!UUID_RE.test(bookingId) || !UUID_RE.test(listingId) || !UUID_RE.test(landlordId) || !UUID_RE.test(tenantId)) {
    return;
  }

  const { rows: existing } = await pool.query(`SELECT 1 FROM messages.messages WHERE thread_id = $1::uuid LIMIT 1`, [
    bookingId,
  ]);
  if (existing.length > 0) return;

  const title = await fetchListingTitle(listingId);
  const subject = `[listing:${listingId}] ${title}`.slice(0, 500);
  const content = `Booking request created for Listing ${title}.`;

  await pool.query(
    `INSERT INTO messages.messages (
       sender_id, recipient_id, group_id, parent_message_id,
       thread_id, message_type, subject, content, is_read
     ) VALUES ($1::uuid, $2::uuid, NULL, NULL, $3::uuid, $4, $5, $6, FALSE)`,
    [tenantId, landlordId, bookingId, "BookingNotice", subject, content],
  );
  console.info("[messaging] booking thread ensured", { booking_id: bookingId, listing_id: listingId });
}

export async function startBookingThreadConsumer(): Promise<Consumer | null> {
  if (process.env.MESSAGING_BOOKING_THREAD_CONSUMER === "0") {
    console.log("[messaging] MESSAGING_BOOKING_THREAD_CONSUMER=0 — booking thread consumer skipped");
    return null;
  }
  if (process.env.KAFKA_SSL_ENABLED === "true") {
    const ca = process.env.KAFKA_CA_CERT || process.env.KAFKA_SSL_CA_PATH;
    if (!ca) {
      console.warn("[messaging] KAFKA_SSL_ENABLED but no CA — booking thread consumer not started");
      return null;
    }
  }

  const consumer = kafka.consumer({
    groupId: process.env.MESSAGING_BOOKING_THREAD_GROUP_ID || "messaging-service-booking-thread-ensure",
  });
  const connectBudgetMs = Number(process.env.MESSAGING_KAFKA_CONNECT_MS || "8000");
  try {
    await Promise.race([
      consumer.connect(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`kafka consumer connect timeout after ${connectBudgetMs}ms`)), connectBudgetMs),
      ),
    ]);
    await consumer.subscribe({ topics: [BOOKING_EVENTS_TOPIC], fromBeginning: false });
    console.log("[messaging] booking-thread consumer subscribed:", BOOKING_EVENTS_TOPIC);

    await consumer.run({
      eachMessage: async ({ message }) => {
        const v = message.value;
        if (!v) return;
        try {
          const raw = JSON.parse(v.toString("utf8")) as Record<string, unknown>;
          const md = (raw.metadata as Record<string, unknown>) || {};
          const eventType = String(md.event_type ?? raw.event_type ?? "").trim();
          const payload = (raw.payload as Record<string, unknown>) || {};
          if (eventType === "booking.thread.ensure") {
            console.info("[messaging] booking.thread.ensure processing", {
              booking_id: String(payload.booking_id ?? ""),
              listing_id: String(payload.listing_id ?? ""),
            });
            await ensureBookingChatThread(payload);
            return;
          }
          if (eventType === "BookingConfirmedV1") {
            console.info("[messaging] BookingConfirmedV1 processing", {
              booking_id: String(payload.booking_id ?? ""),
              listing_id: String(payload.listing_id ?? ""),
            });
            await ensureBookingConfirmedLandlordMessage(payload);
            return;
          }
        } catch (e) {
          console.error("[messaging] booking.thread.ensure handler error", e);
        }
      },
    });
    return consumer;
  } catch (e) {
    console.error("[messaging] booking thread consumer failed to start", e);
    try {
      await consumer.disconnect();
    } catch {
      /* ignore */
    }
    return null;
  }
}
