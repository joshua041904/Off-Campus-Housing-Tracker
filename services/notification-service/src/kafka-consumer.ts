/**
 * Consume domain event topics; insert pending in-app notifications (idempotent via processed_events).
 */
import { trace } from "@opentelemetry/api";
import { kafka, ochKafkaTopicIsolationSuffix } from "@common/utils/kafka";
import { withKafkaConsumerSpan } from "@common/utils/otel";
import { Consumer } from "kafkajs";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  createLandlordBookingNotification,
  normalizeLandlordBookingNotificationPayload,
  parseBookingCreated,
} from "./consumers/booking-created.js";
import { createTenantBookingAcceptedNotification } from "./consumers/booking-accepted.js";
import {
  LANDLORD_BOOKING_CONFIRM_DEDUPE_STATUS,
  bookingNotificationEventForStatus,
  buildNotificationDedupeKey,
} from "./booking-notification-model.js";
import { upsertNotificationByDedupeKey } from "./notification-upsert.js";
import { notificationConsumeLatency } from "./notification-metrics.js";
import { publishRealtimeNotification } from "./realtime-publisher.js";

const PREFIX = process.env.ENV_PREFIX || "dev";

const DEFAULT_TOPIC_CSV = [
  `${PREFIX}.booking.events.v1`,
  `${PREFIX}.listing.events`,
  `${PREFIX}.community.events.v1`,
  `${PREFIX}.notification.events`,
  "messaging.events.v1",
].join(",");

export function notificationKafkaTopics(): string[] {
  const suf = ochKafkaTopicIsolationSuffix();
  const apply = (name: string) => (name === "messaging.events.v1" ? name : `${name}${suf}`);
  return (process.env.NOTIFICATION_KAFKA_TOPICS || DEFAULT_TOPIC_CSV)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(apply);
}

async function ensureProcessed(pool: Pool, eventId: string): Promise<boolean> {
  try {
    const ins = await pool.query(
      `INSERT INTO notification.processed_events (event_id) VALUES ($1::uuid) ON CONFLICT (event_id) DO NOTHING`,
      [eventId]
    );
    return (ins.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Booking-service envelope: `{ metadata: { event_id, event_type, aggregate_id }, payload }` */
function applyBookingEnvelopeTraceAttrs(buf: Buffer): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  try {
    const j = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
    const md = (j.metadata as Record<string, unknown>) || {};
    const eid = md.event_id ?? j.event_id;
    const et = md.event_type ?? j.event_type;
    const aid = md.aggregate_id ?? j.aggregate_id;
    if (eid) span.setAttribute("booking.event_id", String(eid));
    if (et) span.setAttribute("booking.event_type", String(et));
    if (aid) span.setAttribute("booking.aggregate_id", String(aid));
  } catch {
    /* ignore */
  }
}

/** Exported for unit tests: recipient resolution must not treat booking `aggregate_id` as landlord for BookingRequestV1. */
export function extractNotificationEnvelopeMeta(buf: Buffer): {
  eventId: string;
  userId: string | null;
  eventType: string;
} | null {
  try {
    const j = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
    const md = (j.metadata as Record<string, unknown>) || {};
    const eventId = String(md.event_id || j.event_id || j.id || randomUUID());
      const payload = (j.payload as Record<string, unknown>) || {};
      const eventType = String(j.type || j.event_type || md.event_type || md.type || "domain.event");
      // Listings community fan-out events: never treat aggregate_id (post/comment id) as a user recipient.
      if (eventType === "comment.created" || eventType === "post.created") {
        return { eventId, userId: null, eventType };
      }
      if (eventType === "booking.thread.ensure") {
        return { eventId, userId: null, eventType };
      }
      if (eventType === "booking.status.updated") {
        const tenant = String(payload.tenant_id || payload.tenantId || "").trim();
        const landlord = String(payload.landlord_id || payload.landlordId || "").trim();
        const newStatusUpper = String(payload.new_status || "").trim().toUpperCase();
        const changedBy = String(payload.changed_by || "").trim().toLowerCase();
        if (newStatusUpper === "ACCEPTED" && /^[0-9a-f-]{36}$/i.test(tenant)) {
          return { eventId, userId: tenant.toLowerCase(), eventType };
        }
        if (newStatusUpper === "PENDING" && /^[0-9a-f-]{36}$/i.test(landlord)) {
          return { eventId, userId: landlord.toLowerCase(), eventType };
        }
        if (newStatusUpper === "CONFIRMED" && /^[0-9a-f-]{36}$/i.test(landlord)) {
          return { eventId, userId: landlord.toLowerCase(), eventType };
        }
        if (newStatusUpper === "REJECTED" && /^[0-9a-f-]{36}$/i.test(tenant)) {
          return { eventId, userId: tenant.toLowerCase(), eventType };
        }
        if (
          (newStatusUpper === "CANCELLED" || newStatusUpper === "EXPIRED") &&
          /^[0-9a-f-]{36}$/i.test(landlord) &&
          /^[0-9a-f-]{36}$/i.test(tenant)
        ) {
          if (changedBy === "tenant") return { eventId, userId: landlord.toLowerCase(), eventType };
          if (changedBy === "landlord" || changedBy === "system") return { eventId, userId: tenant.toLowerCase(), eventType };
        }
        return { eventId, userId: null, eventType };
      }
      const aggregateId = String(j.aggregate_id || md.aggregate_id || "");
    // Do not use aggregate_id as notification recipient for booking requests: aggregate_id is the booking id.
    const entityId =
      eventType === "BookingRequestV1"
        ? String(
            payload.landlord_id ||
              payload.landlordId ||
              j.entity_id ||
              j.user_id ||
              "",
          ).trim()
        : eventType === "community.comment.notification" || eventType === "community.reply.notification"
          ? String(j.entity_id || j.user_id || "")
          : String(j.entity_id || j.user_id || j.aggregate_id || md.aggregate_id || "");
    // Booking request should notify landlord first; generic fallbacks keep existing behavior.
    const preferredRecipient =
      eventType === "BookingRequestV1"
        ? String(payload.landlord_id || payload.landlordId || payload.recipient_id || "")
        : eventType === "community.comment.notification" || eventType === "community.reply.notification"
          ? String(payload.recipient_id || "")
          : String(payload.user_id || payload.recipient_id || payload.landlord_id || payload.landlordId || "");
    const rawUserId =
      (entityId && /^[0-9a-f-]{36}$/i.test(entityId) ? entityId : null) ||
      (preferredRecipient && /^[0-9a-f-]{36}$/i.test(preferredRecipient) ? preferredRecipient : null) ||
      (eventType !== "BookingRequestV1" &&
      eventType !== "community.comment.notification" &&
      eventType !== "community.reply.notification" &&
      eventType !== "booking.status.updated" &&
      eventType !== "booking.thread.ensure" &&
      aggregateId &&
      /^[0-9a-f-]{36}$/i.test(aggregateId)
        ? aggregateId
        : null);
    const userId =
      rawUserId && /^[0-9a-f-]{36}$/i.test(rawUserId) ? rawUserId.toLowerCase() : null;
    return { eventId, userId: userId && userId.length >= 32 ? userId : null, eventType };
  } catch {
    return null;
  }
}

function notificationRecipientRole(userId: string, tenantId: string, landlordId: string): "tenant" | "landlord" | "user" {
  const normalizedUserId = String(userId || "").trim().toLowerCase();
  if (normalizedUserId && normalizedUserId === String(tenantId || "").trim().toLowerCase()) return "tenant";
  if (normalizedUserId && normalizedUserId === String(landlordId || "").trim().toLowerCase()) return "landlord";
  return "user";
}

function notificationAudienceForRecipientRole(role: "tenant" | "landlord" | "user"): "user" | "landlord" {
  return role === "landlord" ? "landlord" : "user";
}

function bookingNotificationEventTypeFromStatus(newStatus: string): string | null {
  const s = String(newStatus || "").trim().toUpperCase();
  if (s === "PENDING" || s === "CREATED") return "booking.created";
  if (s === "ACCEPTED") return "booking.accepted";
  if (s === "CONFIRMED") return "booking.confirmed";
  if (s === "REJECTED") return "booking.rejected";
  if (s === "CANCELLED") return "booking.cancelled";
  if (s === "EXPIRED") return "booking.expired";
  if (s === "WITHDRAWN") return "booking.withdrawn";
  return null;
}

async function insertBookingLifecycleNotification(pool: Pool, input: {
  userId: string;
  bookingId: string;
  listingId: string;
  landlordId: string;
  tenantId: string;
  listingTitle?: string | null;
  previousStatus?: string | null;
  newStatus: string;
  changedBy?: string | null;
  source: string;
  tenantUsername?: string | null;
  tenantUsernameSnapshot?: string | null;
  tenantDisplayName?: string | null;
  tenantEmail?: string | null;
}): Promise<{ inserted: boolean; notificationId: string | null; eventType: string }> {
  const recipientRole = notificationRecipientRole(input.userId, input.tenantId, input.landlordId);
  const audience: "tenant" | "landlord" = recipientRole === "landlord" ? "landlord" : "tenant";
  const eventType = bookingNotificationEventForStatus(input.newStatus, audience);
  if (!eventType || !/^[0-9a-f-]{36}$/i.test(input.userId) || !/^[0-9a-f-]{36}$/i.test(input.bookingId)) {
    return { inserted: false, notificationId: null, eventType: "" };
  }

  let statusSegment = String(input.newStatus || "").trim().toUpperCase();
  if (audience === "tenant" && ["ACCEPTED", "CONFIRMED"].includes(statusSegment)) {
    statusSegment = "APPROVAL";
  }
  if (audience === "landlord" && eventType === "booking.confirmed") {
    statusSegment = LANDLORD_BOOKING_CONFIRM_DEDUPE_STATUS;
  }

  const tu = String(input.tenantUsername ?? "").trim().replace(/^@+/, "") || null;
  const tus = String(input.tenantUsernameSnapshot ?? "").trim().replace(/^@+/, "") || tu;
  const tdn = String(input.tenantDisplayName ?? "").trim() || null;
  const tem = String(input.tenantEmail ?? "").trim() || null;

  const payloadObj: Record<string, unknown> = {
    notification_audience: notificationAudienceForRecipientRole(recipientRole),
    notification_category: recipientRole === "landlord" ? "booking_landlord" : "booking_renter",
    notification_recipient_role: recipientRole,
    category: "booking",
    context_type: "booking",
    context_id: input.bookingId,
    bookingId: input.bookingId,
    booking_id: input.bookingId,
    listingId: input.listingId || null,
    listing_id: input.listingId || null,
    landlordId: input.landlordId || null,
    landlord_id: input.landlordId || null,
    tenantId: input.tenantId || null,
    tenant_id: input.tenantId || null,
    renterId: input.tenantId || null,
    renter_id: input.tenantId || null,
    tenant_username: tu,
    tenant_username_snapshot: tus || null,
    tenant_display_name: tdn,
    tenant_email: tem,
    tenantEmail: tem,
    renter_username: tus || tu,
    previousStatus: input.previousStatus ?? "",
    previous_status: input.previousStatus ?? "",
    newStatus: input.newStatus,
    new_status: input.newStatus,
    booking_status: input.newStatus,
    changed_by: input.changedBy ?? null,
    listingTitle: input.listingTitle ?? null,
    listing_title: input.listingTitle ?? null,
    deep_link: `/dashboard/bookings/${encodeURIComponent(input.bookingId.toLowerCase())}`,
    source: input.source,
  };

  const dedupeKey = buildNotificationDedupeKey({
    recipientUserId: input.userId,
    eventType,
    contextType: "booking",
    contextId: input.bookingId,
    statusSegment,
  });

  const r = await upsertNotificationByDedupeKey(pool, {
    userId: input.userId,
    eventType,
    payload: payloadObj,
    dedupeKey,
  });
  return { inserted: r.inserted, notificationId: r.notificationId, eventType };
}

export async function startNotificationConsumer(pool: Pool | null): Promise<Consumer | null> {
  if (!pool) {
    console.warn("[notification-kafka] no pool — consumer not started");
    return null;
  }
  if (process.env.NOTIFICATION_KAFKA_CONSUMER === "0") {
    console.log("[notification-kafka] NOTIFICATION_KAFKA_CONSUMER=0 — skipped");
    return null;
  }
  if (process.env.KAFKA_SSL_ENABLED === "true") {
    const ca = process.env.KAFKA_CA_CERT || process.env.KAFKA_SSL_CA_PATH;
    if (!ca) {
      console.warn("[notification-kafka] KAFKA_SSL_ENABLED but no CA — consumer not started");
      return null;
    }
  }

  const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_ID || "notification-service-group" });
  const connectBudgetMs = Number(process.env.NOTIFICATION_KAFKA_CONNECT_MS || "8000");
  try {
    await Promise.race([
      consumer.connect(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`kafka consumer connect timeout after ${connectBudgetMs}ms`)), connectBudgetMs)
      ),
    ]);
    const t = notificationKafkaTopics();
    await consumer.subscribe({ topics: t, fromBeginning: false });
    console.log("[notification-kafka] subscribed:", t.join(", "));

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        const v = message.value;
        if (!v) return;
        await withKafkaConsumerSpan(
          message.headers,
          `kafka consume ${topic}`,
          async () => {
            const started = Date.now();
            try {
              applyBookingEnvelopeTraceAttrs(v);
              const meta = extractNotificationEnvelopeMeta(v);
              if (!meta) return;
              const bookingParsed = parseBookingCreated(v);
              if (
                !meta.userId &&
                bookingParsed?.landlordId &&
                /^[0-9a-f-]{36}$/i.test(bookingParsed.landlordId)
              ) {
                meta.userId = bookingParsed.landlordId.toLowerCase();
              }
              if (!meta.userId) {
                await ensureProcessed(pool, meta.eventId);
                return;
              }
              const ok = await ensureProcessed(pool, meta.eventId);
              if (!ok) return;
              try {
                const bookingCreated = bookingParsed;
                if (bookingCreated) {
                  const inserted = await createLandlordBookingNotification(pool, bookingCreated);
                  const landlordUuid = bookingCreated.landlordId;
                  if (
                    inserted &&
                    typeof landlordUuid === "string" &&
                    /^[0-9a-f-]{36}$/i.test(landlordUuid)
                  ) {
                    console.info("[notification-kafka] booking notification inserted", {
                      landlordId: landlordUuid,
                      listingId: bookingCreated.listingId,
                      renterId: bookingCreated.renterId,
                      bookingId: bookingCreated.bookingId,
                    });
                    const normalized = normalizeLandlordBookingNotificationPayload({
                      ...bookingCreated,
                      landlordId: landlordUuid,
                      notificationSource: "kafka.booking.created",
                    });
                    await publishRealtimeNotification(landlordUuid.toLowerCase(), {
                      event: "booking.created",
                      event_type: "booking.created",
                      ...normalized,
                    });
                  } else if (!inserted && typeof landlordUuid === "string" && /^[0-9a-f-]{36}$/i.test(landlordUuid)) {
                    console.info("[notification-kafka] booking notification deduped (already present)", {
                      landlordId: landlordUuid,
                      bookingId: bookingCreated.bookingId,
                    });
                  } else {
                    console.error("[notification-kafka] booking event skipped DB insert — missing landlord uuid", {
                      eventType: meta.eventType,
                      listingId: bookingCreated.listingId,
                      bookingId: bookingCreated.bookingId,
                    });
                  }
                  return;
                }
                if (
                  meta.eventType === "community.comment.notification" ||
                  meta.eventType === "community.reply.notification"
                ) {
                  let payloadObj: Record<string, unknown> = { source: "kafka" };
                  try {
                    const j = JSON.parse(v.toString("utf8")) as { payload?: Record<string, unknown> };
                    if (j.payload && typeof j.payload === "object") {
                      const explicitAudience = String(j.payload.notification_audience ?? "").trim().toLowerCase();
                      payloadObj = {
                        notification_audience:
                          explicitAudience === "both" || explicitAudience === "landlord" || explicitAudience === "user"
                            ? explicitAudience
                            : String(j.payload.post_flair ?? "").trim().toLowerCase() === "landlord"
                              ? "both"
                              : "user",
                        notification_category: String(j.payload.notification_category ?? "").trim() || "community",
                        notification_recipient_role: "user",
                        type: meta.eventType,
                        post_id: j.payload.post_id,
                        post_title: j.payload.post_title,
                        post_flair: j.payload.post_flair ?? null,
                        comment_id: j.payload.comment_id,
                        parent_comment_id: j.payload.parent_comment_id ?? null,
                        actor_id: j.payload.actor_id,
                        actor_username: j.payload.actor_username ?? null,
                        actor_display_name: j.payload.actor_display_name ?? null,
                        snippet: j.payload.snippet ?? null,
                        deep_link: j.payload.deep_link ?? null,
                        created_at: j.payload.created_at ?? null,
                        source: "kafka",
                      };
                    }
                  } catch {
                    /* keep minimal payload */
                  }
                  await pool.query(
                    `INSERT INTO notification.notifications (user_id, event_type, channel, status, payload)
                     VALUES ($1::uuid, $2, 'push'::notification.notification_channel, 'pending', $3::jsonb)`,
                    [meta.userId, meta.eventType, JSON.stringify(payloadObj)],
                  );
                  await publishRealtimeNotification(meta.userId, {
                    ...payloadObj,
                    event: meta.eventType,
                  });
                  return;
                }
                /** booking.status.updated: structured handling (never fall through to raw_preview). */
                if (meta.eventType === "booking.status.updated") {
                  try {
                    const j = JSON.parse(v.toString("utf8")) as { payload?: Record<string, unknown> };
                    const p = j.payload && typeof j.payload === "object" ? j.payload : {};
                    const newStatus = String(p.new_status || "").trim().toUpperCase();
                    if (newStatus === "ACCEPTED" && meta.userId) {
                      const bookingId = String(p.booking_id || "").trim();
                      const listingId = String(p.listing_id || "").trim();
                      const landlordId = String(p.landlord_id || "").trim();
                      const tenantId = String(p.tenant_id || "").trim();
                      const listingTitle =
                        p.listing_title != null || p.listingTitle != null
                          ? String(p.listing_title ?? p.listingTitle ?? "")
                          : null;
                      const tenantUsername =
                        p.tenant_username != null || p.tenantUsername != null
                          ? String(p.tenant_username ?? p.tenantUsername ?? "").trim()
                          : null;
                      const tenantUsernameSnapshot =
                        p.tenant_username_snapshot != null || p.tenantUsernameSnapshot != null
                          ? String(p.tenant_username_snapshot ?? p.tenantUsernameSnapshot ?? "").trim()
                          : null;
                      const tenantEmail =
                        p.tenant_email != null || p.tenantEmail != null
                          ? String(p.tenant_email ?? p.tenantEmail ?? "").trim()
                          : null;
                      const r = await createTenantBookingAcceptedNotification(pool, {
                        tenantId: meta.userId,
                        bookingId,
                        listingId,
                        landlordId,
                        previousStatus: String(p.previous_status || ""),
                        newStatus: "ACCEPTED",
                        listingTitle: listingTitle && listingTitle.trim() ? listingTitle : null,
                        tenantUsernameSnapshot: tenantUsernameSnapshot || tenantUsername || undefined,
                        tenantEmail: tenantEmail || undefined,
                        notificationSource: "kafka.booking.accepted",
                      });
                      if (r.inserted && r.notificationId && bookingId) {
                        await publishRealtimeNotification(meta.userId, {
                          event: "booking.accepted",
                          event_type: "booking.accepted",
                          bookingId,
                          booking_id: bookingId,
                          listingId,
                          listing_id: listingId,
                          landlordId,
                          landlord_id: landlordId,
                          tenantId,
                          tenant_id: tenantId,
                          previous_status: String(p.previous_status || ""),
                          new_status: "ACCEPTED",
                          listing_title: listingTitle,
                          deep_link: `/dashboard/bookings/${encodeURIComponent(bookingId.toLowerCase())}?nid=${encodeURIComponent(r.notificationId)}`,
                          notification_id: r.notificationId,
                        });
                      }
                      return;
                    }
                    if (newStatus === "PENDING" && meta.userId) {
                      const bookingId = String(p.booking_id || "").trim();
                      const listingId = String(p.listing_id || "").trim();
                      const tenantId = String(p.tenant_id || p.tenantId || "").trim();
                      const listingTitle =
                        p.listing_title != null || p.listingTitle != null
                          ? String(p.listing_title ?? p.listingTitle ?? "").trim()
                          : null;
                      const tenantUsername =
                        p.tenant_username != null || p.tenantUsername != null
                          ? String(p.tenant_username ?? p.tenantUsername ?? "").trim()
                          : null;
                      const tenantUsernameSnapshot =
                        p.tenant_username_snapshot != null || p.tenantUsernameSnapshot != null
                          ? String(p.tenant_username_snapshot ?? p.tenantUsernameSnapshot ?? "").trim()
                          : null;
                      const tenantDisplayName =
                        p.tenant_display_name != null || p.tenantDisplayName != null
                          ? String(p.tenant_display_name ?? p.tenantDisplayName ?? "").trim()
                          : null;
                      const tenantEmail =
                        p.tenant_email != null || p.tenantEmail != null
                          ? String(p.tenant_email ?? p.tenantEmail ?? "").trim()
                          : null;
                      const startDate =
                        p.start_date != null || p.startDate != null
                          ? String(p.start_date ?? p.startDate ?? "").trim()
                          : null;
                      const endDate =
                        p.end_date != null || p.endDate != null
                          ? String(p.end_date ?? p.endDate ?? "").trim()
                          : null;
                      const inserted = await createLandlordBookingNotification(pool, {
                        landlordId: meta.userId,
                        bookingId,
                        listingId,
                        tenantId,
                        createdAt: new Date().toISOString(),
                        listingTitle: listingTitle || undefined,
                        tenantUsername: tenantUsername || undefined,
                        tenantUsernameSnapshot: tenantUsernameSnapshot || tenantUsername || undefined,
                        tenantDisplayName: tenantDisplayName || undefined,
                        tenantEmail: tenantEmail || undefined,
                        bookingStatus: "PENDING",
                        startDate: startDate || undefined,
                        endDate: endDate || undefined,
                        deepLink: bookingId ? `/dashboard/bookings/${encodeURIComponent(bookingId.toLowerCase())}` : undefined,
                        notificationSource: "kafka.booking.status.pending",
                      });
                      if (
                        inserted &&
                        bookingId &&
                        /^[0-9a-f-]{36}$/i.test(bookingId) &&
                        /^[0-9a-f-]{36}$/i.test(meta.userId)
                      ) {
                        const normalized = normalizeLandlordBookingNotificationPayload({
                          landlordId: meta.userId,
                          bookingId,
                          listingId,
                          tenantId,
                          createdAt: new Date().toISOString(),
                          listingTitle: listingTitle || undefined,
                          tenantUsername: tenantUsername || undefined,
                          tenantUsernameSnapshot: tenantUsernameSnapshot || tenantUsername || undefined,
                          tenantDisplayName: tenantDisplayName || undefined,
                          tenantEmail: tenantEmail || undefined,
                          bookingStatus: "PENDING",
                          startDate: startDate || undefined,
                          endDate: endDate || undefined,
                          deepLink: `/dashboard/bookings/${encodeURIComponent(bookingId.toLowerCase())}`,
                          notificationSource: "kafka.booking.status.pending",
                        });
                        await publishRealtimeNotification(meta.userId.toLowerCase(), {
                          event: "booking.created",
                          event_type: "booking.created",
                          ...normalized,
                        });
                      }
                      return;
                    }
                    if (meta.userId) {
                      const bookingId = String(p.booking_id || "").trim().toLowerCase();
                      const listingId = String(p.listing_id || "").trim().toLowerCase();
                      const landlordId = String(p.landlord_id || p.landlordId || "").trim().toLowerCase();
                      const tenantId = String(p.tenant_id || p.tenantId || "").trim().toLowerCase();
                      const listingTitle =
                        p.listing_title != null || p.listingTitle != null
                          ? String(p.listing_title ?? p.listingTitle ?? "").trim()
                          : null;
                      const tenantUsername =
                        p.tenant_username != null || p.tenantUsername != null
                          ? String(p.tenant_username ?? p.tenantUsername ?? "").trim()
                          : null;
                      const tenantUsernameSnapshot =
                        p.tenant_username_snapshot != null || p.tenantUsernameSnapshot != null
                          ? String(p.tenant_username_snapshot ?? p.tenantUsernameSnapshot ?? "").trim()
                          : null;
                      const tenantDisplayName =
                        p.tenant_display_name != null || p.tenantDisplayName != null
                          ? String(p.tenant_display_name ?? p.tenantDisplayName ?? "").trim()
                          : null;
                      const tenantEmail =
                        p.tenant_email != null || p.tenantEmail != null
                          ? String(p.tenant_email ?? p.tenantEmail ?? "").trim()
                          : null;
                      const inserted = await insertBookingLifecycleNotification(pool, {
                        userId: meta.userId,
                        bookingId,
                        listingId,
                        landlordId,
                        tenantId,
                        listingTitle,
                        previousStatus: String(p.previous_status || ""),
                        newStatus,
                        changedBy: String(p.changed_by || ""),
                        source: `kafka.booking.${newStatus.toLowerCase()}`,
                        tenantUsername: tenantUsername || undefined,
                        tenantUsernameSnapshot: tenantUsernameSnapshot || tenantUsername || undefined,
                        tenantDisplayName: tenantDisplayName || undefined,
                        tenantEmail: tenantEmail || undefined,
                      });
                      if (newStatus === "CONFIRMED" && /^[0-9a-f-]{36}$/i.test(tenantId)) {
                        const tIns = await createTenantBookingAcceptedNotification(pool, {
                          tenantId,
                          bookingId,
                          listingId,
                          landlordId,
                          previousStatus: String(p.previous_status || ""),
                          newStatus: "CONFIRMED",
                          listingTitle,
                          tenantUsernameSnapshot: tenantUsernameSnapshot || tenantUsername || undefined,
                          tenantEmail: tenantEmail || undefined,
                          notificationSource: "kafka.booking.confirmed",
                        });
                        if (tIns.inserted && tIns.notificationId) {
                          await publishRealtimeNotification(tenantId, {
                            event: "booking.accepted",
                            event_type: "booking.accepted",
                            notification_id: tIns.notificationId,
                            bookingId,
                            booking_id: bookingId,
                            listing_id: listingId,
                            landlord_id: landlordId,
                            tenant_id: tenantId,
                            new_status: "CONFIRMED",
                            listing_title: listingTitle,
                            deep_link: `/dashboard/bookings/${encodeURIComponent(bookingId)}?nid=${encodeURIComponent(tIns.notificationId)}`,
                          });
                        }
                      }
                      if (inserted.inserted && inserted.notificationId && bookingId) {
                        const recipientRole = notificationRecipientRole(meta.userId, tenantId, landlordId);
                        const ev =
                          (inserted.eventType && inserted.eventType.trim()) ||
                          bookingNotificationEventTypeFromStatus(newStatus) ||
                          meta.eventType;
                        await publishRealtimeNotification(meta.userId, {
                          event: ev,
                          event_type: ev,
                          notification_id: inserted.notificationId,
                          notification_audience: notificationAudienceForRecipientRole(recipientRole),
                          notification_category: recipientRole === "landlord" ? "booking_landlord" : "booking_renter",
                          notification_recipient_role: recipientRole,
                          bookingId,
                          booking_id: bookingId,
                          listingId,
                          listing_id: listingId,
                          landlordId,
                          landlord_id: landlordId,
                          tenantId,
                          tenant_id: tenantId,
                          previous_status: String(p.previous_status || ""),
                          new_status: newStatus,
                          booking_status: newStatus,
                          listing_title: listingTitle,
                          changed_by: String(p.changed_by || ""),
                          deep_link: `/dashboard/bookings/${encodeURIComponent(bookingId)}?nid=${encodeURIComponent(inserted.notificationId)}`,
                        });
                      }
                    }
                  } catch {
                    /* ignore */
                  }
                  return;
                }
                await pool.query(
                  `INSERT INTO notification.notifications (user_id, event_type, channel, status, payload)
             VALUES ($1::uuid, $2, 'push'::notification.notification_channel, 'pending', $3::jsonb)`,
                  [
                    meta.userId,
                    meta.eventType,
                    JSON.stringify({
                      notification_audience: "user",
                      notification_category: "system",
                      notification_recipient_role: "user",
                      source: "kafka",
                      raw_preview: v.toString("utf8").slice(0, 2000),
                    }),
                  ],
                );
                await publishRealtimeNotification(meta.userId, {
                  event: meta.eventType,
                  preview: v.toString("utf8").slice(0, 500),
                });
              } catch (e) {
                console.error("[notification-kafka] insert failed", e);
                try {
                  await pool.query(`DELETE FROM notification.processed_events WHERE event_id = $1::uuid`, [
                    meta.eventId,
                  ]);
                } catch {
                  /* ignore rollback errors */
                }
              }
            } finally {
              notificationConsumeLatency.observe((Date.now() - started) / 1000);
            }
          },
          { "messaging.system": "kafka", "messaging.destination.name": topic },
        );
      },
    });
    return consumer;
  } catch (e) {
    console.error("[notification-kafka] failed to start", e);
    try {
      await consumer.disconnect();
    } catch {
      /* ignore */
    }
    return null;
  }
}
