import express, { type Application, type NextFunction, type Request, type Response } from "express";
import { httpCounter, register, createHttpConcurrencyGuard, initOchOutboxSurfaceUnsupported } from "@common/utils";
import { inferNetProtoForSpan, mountDebugTraceHeaders, tracingMiddleware } from "@common/utils/otel";
import {
  createLandlordBookingNotification,
  normalizeLandlordBookingNotificationPayload,
} from "./consumers/booking-created.js";
import { createTenantBookingAcceptedNotification } from "./consumers/booking-accepted.js";
import { pool } from "./db.js";
import { publishRealtimeNotification } from "./realtime-publisher.js";
import {
  getCachedNotificationList,
  invalidateNotificationListCacheForUser,
  notificationListCacheHeaders,
  setCachedNotificationList,
  type NotificationListCacheQuery,
} from "./notification-list-cache.js";
import { bookingContextMatchForBookingSql } from "./booking-context-sql.js";
import { markBookingContextRead } from "./mark-booking-context-read.js";
import { applyBookingContextReadStateToRows } from "./notification-list-booking-read.js";
import { countCollapsedUnreadNotifications } from "./notification-unread-collapsed.js";
import { syncBookingContextReadStateForUser } from "./sync-booking-context-read.js";
import {
  logNotificationDiagnostics,
  rowToDiagnostic,
  surfaceWhereClause,
  type NotificationAudienceScope,
} from "./notification-visibility.js";

type AuthedRequest = Request & { userId?: string };

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** booking-service mesh → internal push: any 36-char UUID string (DB/JWT may differ from strict RFC variant bits). */
const MESH_UUID36 = /^[0-9a-f-]{36}$/i;

function requireBookingMeshSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = (process.env.BOOKING_LISTINGS_INTERNAL_SECRET || "").trim();
  const h = (req.get("x-booking-internal-secret") || "").trim();
  if (!secret || h !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

function requireUser(req: AuthedRequest, res: Response, next: NextFunction): void {
  const raw = (req.get("x-user-id") || "").trim();
  if (!raw) {
    res.status(401).json({ error: "missing x-user-id" });
    return;
  }
  if (!MESH_UUID36.test(raw)) {
    res.status(400).json({ error: "invalid x-user-id" });
    return;
  }
  req.userId = raw.toLowerCase();
  next();
}

function normalizeContextBookingId(raw: unknown): string {
  const bookingId = String(raw || "").trim().toLowerCase();
  return MESH_UUID36.test(bookingId) ? bookingId : "";
}

function parseAudienceScope(raw: unknown): NotificationAudienceScope {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "landlord") return "landlord";
  if (v === "all") return "all";
  return "user";
}

export function createNotificationHttpApp(): Application {
  const app = express();
  initOchOutboxSurfaceUnsupported();
  app.use(tracingMiddleware);
  mountDebugTraceHeaders(app);
  app.use(express.json({ limit: "512kb" }));
  app.use((req, res, next) => {
    res.on("finish", () =>
      httpCounter.inc({
        service: "notification",
        route: req.path,
        method: req.method,
        code: res.statusCode,
        proto: inferNetProtoForSpan(req),
      })
    );
    next();
  });

  app.get(["/healthz", "/health"], async (_req, res) => {
    if (!pool) {
      res.json({ ok: true, db: "skipped", warning: "POSTGRES_URL_NOTIFICATION unset" });
      return;
    }
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, db: "connected" });
    } catch {
      res.json({ ok: true, db: "disconnected", warning: "database unavailable" });
    }
  });

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  });

  /** Internal: cron-jobs / ops ping (no auth). */
  app.post("/internal/cron/heartbeat", async (_req, res) => {
    res.json({ ok: true, at: new Date().toISOString() });
  });

  /** In-cluster: booking-service inserts saved-search match notifications (shared mesh secret). */
  app.post("/internal/push-notification", requireBookingMeshSecret, async (req: Request, res: Response) => {
    if (!pool) return res.status(503).json({ error: "db unavailable" });
    const b = (req.body || {}) as {
      user_id?: unknown;
      event_type?: unknown;
      payload?: Record<string, unknown>;
    };
    const userIdRaw = String(b.user_id || "").trim();
    const userId = MESH_UUID36.test(userIdRaw) ? userIdRaw.toLowerCase() : userIdRaw;
    const eventType = String(b.event_type || "").trim();
    if (!MESH_UUID36.test(userId) || !eventType) {
      res.status(400).json({ error: "user_id (uuid) and event_type required" });
      return;
    }
    const payload = b.payload && typeof b.payload === "object" ? b.payload : {};
    try {
      /** Landlord booking request: same idempotent path as Kafka consumer (dedupes by booking id). */
      if (eventType === "booking.created") {
        const bidRaw = String((payload as Record<string, unknown>).bookingId ?? (payload as Record<string, unknown>).booking_id ?? "").trim();
        const bid = MESH_UUID36.test(bidRaw) ? bidRaw.toLowerCase() : bidRaw;
        if (MESH_UUID36.test(bid)) {
          const listingId = String((payload as Record<string, unknown>).listingId ?? (payload as Record<string, unknown>).listing_id ?? "").trim();
          const tenantId = String(
            (payload as Record<string, unknown>).tenantId ??
              (payload as Record<string, unknown>).tenant_id ??
              (payload as Record<string, unknown>).renterId ??
              (payload as Record<string, unknown>).renter_id ??
              "",
          ).trim();
          const listingTitle =
            (payload as Record<string, unknown>).listingTitle != null ||
            (payload as Record<string, unknown>).listing_title != null
              ? String((payload as Record<string, unknown>).listingTitle ?? (payload as Record<string, unknown>).listing_title ?? "")
              : null;
          const tenantUsername =
            (payload as Record<string, unknown>).tenantUsername != null ||
            (payload as Record<string, unknown>).tenant_username != null
              ? String((payload as Record<string, unknown>).tenantUsername ?? (payload as Record<string, unknown>).tenant_username ?? "")
              : null;
          const tenantUsernameSnapshot =
            (payload as Record<string, unknown>).tenantUsernameSnapshot != null ||
            (payload as Record<string, unknown>).tenant_username_snapshot != null
              ? String(
                  (payload as Record<string, unknown>).tenantUsernameSnapshot ??
                    (payload as Record<string, unknown>).tenant_username_snapshot ??
                    "",
                )
              : null;
          const tenantDisplayName =
            (payload as Record<string, unknown>).tenantDisplayName != null ||
            (payload as Record<string, unknown>).tenant_display_name != null
              ? String((payload as Record<string, unknown>).tenantDisplayName ?? (payload as Record<string, unknown>).tenant_display_name ?? "")
              : null;
          const tenantEmail =
            (payload as Record<string, unknown>).tenantEmail != null ||
            (payload as Record<string, unknown>).tenant_email != null
              ? String((payload as Record<string, unknown>).tenantEmail ?? (payload as Record<string, unknown>).tenant_email ?? "")
              : null;
          const bookingStatus =
            (payload as Record<string, unknown>).bookingStatus != null ||
            (payload as Record<string, unknown>).booking_status != null
              ? String((payload as Record<string, unknown>).bookingStatus ?? (payload as Record<string, unknown>).booking_status ?? "")
              : null;
          const startDate =
            (payload as Record<string, unknown>).startDate != null ||
            (payload as Record<string, unknown>).start_date != null
              ? String((payload as Record<string, unknown>).startDate ?? (payload as Record<string, unknown>).start_date ?? "")
              : null;
          const endDate =
            (payload as Record<string, unknown>).endDate != null ||
            (payload as Record<string, unknown>).end_date != null
              ? String((payload as Record<string, unknown>).endDate ?? (payload as Record<string, unknown>).end_date ?? "")
              : null;
          const createdAt = String((payload as Record<string, unknown>).createdAt ?? (payload as Record<string, unknown>).created_at ?? "").trim();
          const normalized = normalizeLandlordBookingNotificationPayload({
            landlordId: userId,
            bookingId: bid,
            listingId: listingId || undefined,
            tenantId: tenantId || undefined,
            createdAt: createdAt || undefined,
            listingTitle: listingTitle || undefined,
            tenantUsername: tenantUsername && tenantUsername.trim() ? tenantUsername.trim() : undefined,
            tenantUsernameSnapshot:
              tenantUsernameSnapshot && tenantUsernameSnapshot.trim() ? tenantUsernameSnapshot.trim() : undefined,
            tenantDisplayName: tenantDisplayName && tenantDisplayName.trim() ? tenantDisplayName.trim() : undefined,
            tenantEmail: tenantEmail && tenantEmail.trim() ? tenantEmail.trim() : undefined,
            bookingStatus: bookingStatus || undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            deepLink:
              String((payload as Record<string, unknown>).deepLink ?? (payload as Record<string, unknown>).deep_link ?? "").trim() ||
              undefined,
            notificationSource: String((payload as Record<string, unknown>).source || "http.internal.push"),
          });
          const inserted = await createLandlordBookingNotification(pool, {
            landlordId: userId,
            bookingId: bid,
            listingId: listingId || undefined,
            tenantId: tenantId || undefined,
            createdAt: createdAt || undefined,
            listingTitle: listingTitle || undefined,
            tenantUsername: tenantUsername && tenantUsername.trim() ? tenantUsername.trim() : undefined,
            tenantUsernameSnapshot:
              tenantUsernameSnapshot && tenantUsernameSnapshot.trim() ? tenantUsernameSnapshot.trim() : undefined,
            tenantDisplayName: tenantDisplayName && tenantDisplayName.trim() ? tenantDisplayName.trim() : undefined,
            tenantEmail: tenantEmail && tenantEmail.trim() ? tenantEmail.trim() : undefined,
            bookingStatus: bookingStatus || undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            deepLink: String(normalized.deep_link ?? "").trim() || undefined,
            notificationSource: String((payload as Record<string, unknown>).source || "http.internal.push"),
          });
          if (inserted) {
            await publishRealtimeNotification(userId, {
              event: eventType,
              event_type: eventType,
              ...normalized,
            });
          }
          res.status(201).json({ ok: true, inserted });
          return;
        }
      }

      /** Landlord approved: same idempotent path as Kafka consumer (dedupes by tenant + booking id). */
      if (eventType === "booking.accepted") {
        const bidRaw = String((payload as Record<string, unknown>).bookingId ?? (payload as Record<string, unknown>).booking_id ?? "").trim();
        const bid = MESH_UUID36.test(bidRaw) ? bidRaw.toLowerCase() : bidRaw;
        const listingId = String((payload as Record<string, unknown>).listingId ?? (payload as Record<string, unknown>).listing_id ?? "").trim();
        const landlordId = String(
          (payload as Record<string, unknown>).landlordId ?? (payload as Record<string, unknown>).landlord_id ?? "",
        ).trim();
        const tenantFromPayload = String(
          (payload as Record<string, unknown>).tenantId ?? (payload as Record<string, unknown>).tenant_id ?? "",
        ).trim();
        const listingTitle =
          (payload as Record<string, unknown>).listingTitle != null
            ? String((payload as Record<string, unknown>).listingTitle)
            : null;
        const prev = String((payload as Record<string, unknown>).previousStatus ?? (payload as Record<string, unknown>).previous_status ?? "").trim();
        const domainNew = String(
          (payload as Record<string, unknown>).newStatus ??
            (payload as Record<string, unknown>).new_status ??
            (payload as Record<string, unknown>).bookingStatus ??
            (payload as Record<string, unknown>).booking_status ??
            "ACCEPTED",
        )
          .trim()
          .toUpperCase();
        const tenantUsernameSnapshot = String(
          (payload as Record<string, unknown>).tenantUsernameSnapshot ??
            (payload as Record<string, unknown>).tenant_username_snapshot ??
            (payload as Record<string, unknown>).tenantUsername ??
            (payload as Record<string, unknown>).tenant_username ??
            "",
        ).trim();
        const tenantEmail = String(
          (payload as Record<string, unknown>).tenantEmail ?? (payload as Record<string, unknown>).tenant_email ?? "",
        ).trim();
        if (MESH_UUID36.test(bid) && MESH_UUID36.test(userId)) {
          const r = await createTenantBookingAcceptedNotification(pool, {
            tenantId: userId,
            bookingId: bid,
            listingId,
            landlordId,
            previousStatus: prev || null,
            newStatus: domainNew === "CONFIRMED" ? "CONFIRMED" : "ACCEPTED",
            listingTitle,
            tenantUsernameSnapshot: tenantUsernameSnapshot || undefined,
            tenantUsername: tenantUsernameSnapshot || undefined,
            tenantEmail: tenantEmail || undefined,
            notificationSource: String((payload as Record<string, unknown>).source || "http.internal.push"),
          });
          if (r.inserted && r.notificationId) {
            await publishRealtimeNotification(userId, {
              event: "booking.accepted",
              event_type: "booking.accepted",
              bookingId: bid,
              booking_id: bid,
              listing_id: listingId || (payload as Record<string, unknown>).listing_id,
              landlord_id: landlordId || (payload as Record<string, unknown>).landlord_id,
              tenant_id: tenantFromPayload || userId,
              previous_status: prev,
              new_status: domainNew === "CONFIRMED" ? "CONFIRMED" : "ACCEPTED",
              listing_title: listingTitle,
              deep_link: `/dashboard/bookings/${encodeURIComponent(bid)}?nid=${encodeURIComponent(r.notificationId)}`,
              notification_id: r.notificationId,
            });
          }
          res.status(201).json({ ok: true, inserted: r.inserted, notification_id: r.notificationId });
          return;
        }
      }

      const decoratedPayload = {
        notification_audience:
          String((payload as Record<string, unknown>).notification_audience || "").trim() || "user",
        notification_category:
          String((payload as Record<string, unknown>).notification_category || "").trim() ||
          (eventType === "community.comment.notification" || eventType === "community.reply.notification"
            ? "community"
            : eventType.toLowerCase().includes("message") || eventType.toLowerCase().includes("dm")
              ? "message"
              : eventType.toLowerCase().includes("watchlist") || eventType.toLowerCase().includes("search")
                ? "watchlist"
                : "system"),
        notification_recipient_role:
          String((payload as Record<string, unknown>).notification_recipient_role || "").trim() || "user",
        ...payload,
      };
      await pool.query(
        `INSERT INTO notification.notifications (user_id, event_type, channel, status, payload)
         VALUES ($1::uuid, $2, 'push'::notification.notification_channel, 'pending', $3::jsonb)`,
        [userId, eventType.slice(0, 120), JSON.stringify(decoratedPayload)],
      );
      await publishRealtimeNotification(userId, {
        event: eventType,
        ...decoratedPayload,
      });
      res.status(201).json({ ok: true });
    } catch (e) {
      console.error("[notification internal push]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.use(
    createHttpConcurrencyGuard({
      envVar: "NOTIFICATION_HTTP_MAX_CONCURRENT",
      defaultMax: 60,
      serviceLabel: "notification-service",
    }),
  );

  app.get("/preferences", requireUser, async (req: AuthedRequest, res: Response) => {
    if (!pool) return res.status(503).json({ error: "db unavailable" });
    try {
      const r = await pool.query(
        `SELECT email_enabled, sms_enabled, push_enabled, booking_alerts, message_alerts, moderation_alerts
         FROM notification.user_preferences WHERE user_id = $1::uuid`,
        [req.userId]
      );
      if (!r.rows.length) {
        return res.json({
          user_id: req.userId,
          email_enabled: true,
          sms_enabled: false,
          push_enabled: true,
          booking_alerts: true,
          message_alerts: true,
          moderation_alerts: true,
        });
      }
      const row = r.rows[0];
      res.json({
        user_id: req.userId,
        email_enabled: row.email_enabled,
        sms_enabled: row.sms_enabled,
        push_enabled: row.push_enabled,
        booking_alerts: row.booking_alerts,
        message_alerts: row.message_alerts,
        moderation_alerts: row.moderation_alerts,
      });
    } catch (e) {
      console.error("[preferences get]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.put("/preferences", requireUser, async (req: AuthedRequest, res: Response) => {
    if (!pool) return res.status(503).json({ error: "db unavailable" });
    const b = req.body || {};
    try {
      await pool.query(
        `INSERT INTO notification.user_preferences
          (user_id, email_enabled, sms_enabled, push_enabled, booking_alerts, message_alerts, moderation_alerts)
         VALUES ($1::uuid, COALESCE($2, true), COALESCE($3, false), COALESCE($4, true), COALESCE($5, true), COALESCE($6, true), COALESCE($7, true))
         ON CONFLICT (user_id) DO UPDATE SET
           email_enabled = COALESCE(EXCLUDED.email_enabled, notification.user_preferences.email_enabled),
           sms_enabled = COALESCE(EXCLUDED.sms_enabled, notification.user_preferences.sms_enabled),
           push_enabled = COALESCE(EXCLUDED.push_enabled, notification.user_preferences.push_enabled),
           booking_alerts = COALESCE(EXCLUDED.booking_alerts, notification.user_preferences.booking_alerts),
           message_alerts = COALESCE(EXCLUDED.message_alerts, notification.user_preferences.message_alerts),
           moderation_alerts = COALESCE(EXCLUDED.moderation_alerts, notification.user_preferences.moderation_alerts),
           updated_at = now()`,
        [
          req.userId,
          b.email_enabled,
          b.sms_enabled,
          b.push_enabled,
          b.booking_alerts,
          b.message_alerts,
          b.moderation_alerts,
        ]
      );
      res.json({ ok: true });
    } catch (e) {
      console.error("[preferences put]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/notifications", requireUser, async (req: AuthedRequest, res: Response) => {
    if (!pool) return res.status(503).json({ error: "db unavailable" });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rawTypes = String(req.query.event_types ?? req.query.eventTypes ?? "").trim();
    const typeList = rawTypes
      ? [
          ...new Set(
            rawTypes
              .split(",")
              .map((s) => s.trim())
              .filter((s) => /^[a-zA-Z0-9._-]{1,120}$/.test(s)),
          ),
        ]
      : null;
    const rawAudience = String(req.query.audience ?? "").trim().toLowerCase();
    const rawCategory = String(req.query.category ?? "").trim().toLowerCase();
    const scopeParam = String(req.query.scope ?? "").trim().toLowerCase();
    const scopeFromQuery: NotificationAudienceScope | null =
      scopeParam === "landlord" || scopeParam === "user" || scopeParam === "all" ? scopeParam : null;
    const audienceFilter =
      rawAudience === "landlord" || rawAudience === "user" || rawAudience === "both" ? rawAudience : null;
    const categoryBooking = rawCategory === "booking";
    const listScope: NotificationAudienceScope =
      scopeFromQuery ??
      (audienceFilter === "landlord" ? "landlord" : audienceFilter === "user" || audienceFilter === "both" ? "user" : "all");
    const cacheQuery: NotificationListCacheQuery = {
      userId: String(req.userId),
      limit,
      audience: audienceFilter,
      categoryBooking,
      eventTypes: typeList,
      scope: listScope,
    };

    const started = Date.now();
    try {
      await syncBookingContextReadStateForUser(pool, String(req.userId));
      const cached = await getCachedNotificationList(cacheQuery);
      if (cached) {
        let cachedItems = applyBookingContextReadStateToRows(
          cached.items as Record<string, unknown>[],
        );
        for (const [k, v] of Object.entries(notificationListCacheHeaders(true, "redis"))) {
          res.setHeader(k, v);
        }
        res.setHeader("X-OCH-Server-Time-Ms", String(Date.now() - started));
        res.json({ items: cachedItems });
        return;
      }

      const where: string[] = [surfaceWhereClause(listScope, "n")];
      const params: unknown[] = [req.userId];
      if (typeList && typeList.length > 0) {
        where.push(`n.event_type = ANY($${params.length + 1}::text[])`);
        params.push(typeList);
      }
      if (categoryBooking) {
        where.push(
          `(COALESCE(n.payload->>'notification_category','') IN ('booking_renter','booking_landlord') OR n.event_type LIKE 'booking.%')`,
        );
      }
      params.push(limit);
      const limIdx = params.length;
      const sql = `SELECT n.id, n.user_id::text AS user_id, n.event_type, n.channel::text, n.status::text, n.payload, n.created_at, n.read_at, n.dedupe_key
         FROM notification.notifications n
         WHERE ${where.join(" AND ")}
         ORDER BY n.created_at DESC LIMIT $${limIdx}`;
      const r = await pool.query(sql, params);
      let rows = applyBookingContextReadStateToRows(r.rows as Record<string, unknown>[]);
      const body = { items: rows };
      await setCachedNotificationList(cacheQuery, rows);
      const diagRows = r.rows.map((row: Record<string, unknown>) => rowToDiagnostic(row));
      logNotificationDiagnostics("GET /notifications", {
        userId: String(req.userId),
        params: { limit, scope: listScope, audience: audienceFilter, category: rawCategory, event_types: typeList },
        returnedCount: r.rows.length,
        unreadCount: diagRows.filter((row) => !row.read_at).length,
        rows: diagRows,
      });
      for (const [k, v] of Object.entries(notificationListCacheHeaders(false, "db"))) {
        res.setHeader(k, v);
      }
      const elapsedMs = Date.now() - started;
      res.setHeader("X-OCH-Server-Time-Ms", String(elapsedMs));
      console.info("[notifications list] timing", {
        userId: String(req.userId),
        scope: listScope,
        elapsedMs,
        rowCount: rows.length,
        cached: false,
      });
      res.json(body);
    } catch (e) {
      console.error("[notifications list]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/notifications/unread-count", requireUser, async (req: AuthedRequest, res: Response) => {
    if (!pool) return res.status(503).json({ error: "db unavailable" });
    const scope = parseAudienceScope(req.query.scope);
    try {
      const unreadCount = await countCollapsedUnreadNotifications(pool, String(req.userId), scope);
      const where = `${surfaceWhereClause(scope)} AND read_at IS NULL`;
      const offenders = await pool.query(
        `SELECT id, event_type, payload, created_at, read_at
         FROM notification.notifications n
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT 25`,
        [req.userId],
      );
      const rows = offenders.rows.map((row: Record<string, unknown>) => rowToDiagnostic(row));
      logNotificationDiagnostics("GET /notifications/unread-count", {
        userId: String(req.userId),
        params: { scope },
        unreadCount,
        notificationIds: rows.map((row) => row.id),
        bookingContextIds: rows
          .map((row) => row.context_id || row.payload_booking_id || row.payload_bookingId)
          .filter(Boolean) as string[],
        rows,
      });
      res.json({ unreadCount, scope });
    } catch (e) {
      console.error("[notifications unread-count]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/notifications/:notificationId/read", requireUser, async (req: AuthedRequest, res: Response) => {
    if (!pool) return res.status(503).json({ error: "db unavailable" });
    const nid = String(req.params.notificationId || "").trim();
    if (!MESH_UUID36.test(nid)) {
      res.status(400).json({ error: "invalid notification id" });
      return;
    }
    try {
      const notificationId = nid.toLowerCase();
      console.info("[notifications mark read] request", {
        notificationId,
        userId: req.userId,
      });
      const existing = await pool.query(
        `SELECT id, user_id, read_at
         FROM notification.notifications
         WHERE id = $1::uuid`,
        [notificationId],
      );
      if (!existing.rows.length) {
        console.warn("[notifications mark read] notification id not found", {
          notificationId,
          userId: req.userId,
        });
        res.status(404).json({ error: "not found" });
        return;
      }
      const ownerUserId = String(existing.rows[0]?.user_id || "").trim().toLowerCase();
      if (ownerUserId !== String(req.userId || "").trim().toLowerCase()) {
        console.warn("[notifications mark read] notification belongs to another user", {
          notificationId,
          ownerUserId,
          userId: req.userId,
        });
        res.status(404).json({ error: "not found" });
        return;
      }
      const updated = await pool.query(
        `UPDATE notification.notifications
         SET read_at = COALESCE(read_at, now())
         WHERE id = $1::uuid AND user_id = $2::uuid AND read_at IS NULL
         RETURNING id, read_at, event_type, payload`,
        [notificationId, req.userId],
      );
      const isBookingRow = (row: Record<string, unknown> | undefined): boolean => {
        const et = String(row?.event_type ?? "");
        const payload = (row?.payload ?? {}) as Record<string, unknown>;
        const cat = String(payload.category ?? payload.notification_category ?? "");
        return et.startsWith("booking.") || cat === "booking" || cat.startsWith("booking_");
      };
      const rowForContext = updated.rows[0] ?? existing.rows[0];
      if (isBookingRow(rowForContext as Record<string, unknown>)) {
        await markBookingContextRead(pool, {
          userId: String(req.userId),
          notificationId,
        });
        await syncBookingContextReadStateForUser(pool, String(req.userId));
      }
      if (!updated.rows.length) {
        const latest = await pool.query(
          `SELECT id, read_at
           FROM notification.notifications
           WHERE id = $1::uuid AND user_id = $2::uuid`,
          [notificationId, req.userId],
        );
        const latestRow = latest.rows[0] ?? existing.rows[0];
        console.warn("[notifications mark read] update affected 0 rows", {
          notificationId,
          userId: req.userId,
          affectedRows: Number(updated.rowCount ?? 0),
          readAt: latestRow?.read_at ?? null,
          reason: latestRow?.read_at ? "already_read" : "no_match",
        });
        const purgedKeys = req.userId
          ? await invalidateNotificationListCacheForUser(req.userId)
          : 0;
        console.info("[notifications mark read] cache invalidated", {
          userId: req.userId,
          purgedCacheKeys: purgedKeys,
        });
        res.json({
          ok: true,
          notification_id: latestRow?.id ?? notificationId,
          read_at: latestRow?.read_at ?? null,
          updated: Number(updated.rowCount ?? 0),
          affected_rows: Number(updated.rowCount ?? 0),
        });
        return;
      }
      const purgedKeys = req.userId ? await invalidateNotificationListCacheForUser(req.userId) : 0;
      console.info("[notifications mark read] cache invalidated", {
        userId: req.userId,
        purgedCacheKeys: purgedKeys,
      });
      const diagRows = [rowToDiagnostic({ ...existing.rows[0], read_at: updated.rows[0]?.read_at ?? existing.rows[0]?.read_at })];
      logNotificationDiagnostics("POST /notifications/:id/read", {
        userId: String(req.userId),
        params: { notificationId },
        returnedCount: 1,
        notificationIds: [notificationId],
        rows: diagRows,
      });
      console.info("[notifications mark read] result", {
        notificationId,
        userId: req.userId,
        affectedRows: Number(updated.rowCount ?? updated.rows.length ?? 0),
        readAt: updated.rows[0]?.read_at ?? null,
      });
      res.json({
        ok: true,
        notification_id: updated.rows[0].id,
        read_at: updated.rows[0].read_at,
        updated: Number(updated.rowCount ?? updated.rows.length ?? 0),
        affected_rows: Number(updated.rowCount ?? updated.rows.length ?? 0),
      });
    } catch (e) {
      console.error("[notifications mark read]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/notifications/mark-context-read", requireUser, async (req: AuthedRequest, res: Response) => {
    if (!pool) return res.status(503).json({ error: "db unavailable" });
    const body = (req.body || {}) as {
      context_type?: unknown;
      booking_id?: unknown;
      bookingId?: unknown;
      notification_id?: unknown;
      notificationId?: unknown;
    };
    const contextType = String(body.context_type || "booking").trim().toLowerCase();
    if (contextType !== "booking") {
      res.status(400).json({ error: "context_type=booking required" });
      return;
    }
    const bookingId = normalizeContextBookingId(body.booking_id ?? body.bookingId);
    const notificationId = String(body.notification_id ?? body.notificationId ?? "").trim().toLowerCase();
    if (!bookingId && !MESH_UUID36.test(notificationId)) {
      res.status(400).json({ error: "booking_id or notification_id required" });
      return;
    }
    try {
      let result = await markBookingContextRead(pool, {
        userId: String(req.userId),
        bookingId: bookingId || undefined,
        notificationId: MESH_UUID36.test(notificationId) ? notificationId : undefined,
      });
      const resolvedBookingId = String(result.booking_id || bookingId || "").trim().toLowerCase();
      if (resolvedBookingId && result.updated === 0) {
        result = await markBookingContextRead(pool, {
          userId: String(req.userId),
          bookingId: resolvedBookingId,
          notificationId: MESH_UUID36.test(notificationId) ? notificationId : undefined,
        });
      }
      await syncBookingContextReadStateForUser(pool, String(req.userId));
      const purgedKeys = req.userId ? await invalidateNotificationListCacheForUser(req.userId) : 0;
      const offenderCheck = resolvedBookingId
        ? await pool.query(
            `SELECT id, event_type, payload, read_at, created_at
             FROM notification.notifications n
             WHERE n.user_id = $1::uuid
               AND read_at IS NULL
               AND ${bookingContextMatchForBookingSql("n", "$2")}
             ORDER BY created_at DESC`,
            [req.userId, resolvedBookingId],
          )
        : { rows: [] as Record<string, unknown>[] };
      const rows = offenderCheck.rows.map((row: Record<string, unknown>) => rowToDiagnostic(row));
      logNotificationDiagnostics("POST /notifications/mark-context-read", {
        userId: String(req.userId),
        params: { bookingId, notificationId },
        returnedCount: result.affected_rows,
        unreadCount: rows.filter((row) => !row.read_at).length,
        notificationIds: result.notification_ids,
        bookingContextIds: result.booking_id ? [result.booking_id] : [],
        rows,
      });
      console.info("[notifications mark context read] result", {
        userId: req.userId,
        bookingId: result.booking_id,
        affectedRows: result.affected_rows,
        notificationIds: result.notification_ids,
        purgedCacheKeys: purgedKeys,
      });
      res.json({
        ok: true,
        updated: result.updated,
        affected_rows: result.affected_rows,
        context_type: contextType,
        booking_id: result.booking_id ?? bookingId,
        read_at: result.read_at,
        notification_ids: result.notification_ids,
      });
    } catch (e) {
      console.error("[notifications mark context read]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.post("/notifications/mark-read", requireUser, async (req: AuthedRequest, res: Response) => {
    if (!pool) return res.status(503).json({ error: "db unavailable" });
    const idsIn = (req.body as { notification_ids?: unknown })?.notification_ids;
    const ids = Array.isArray(idsIn)
      ? idsIn.map((x) => String(x || "").trim()).filter((x) => MESH_UUID36.test(x)).map((x) => x.toLowerCase())
      : [];
    if (!ids.length) {
      res.status(400).json({ error: "notification_ids array required" });
      return;
    }
    const capped = ids.slice(0, 100);
    try {
      const r = await pool.query(
        `UPDATE notification.notifications
         SET read_at = COALESCE(read_at, now())
         WHERE user_id = $1::uuid AND id = ANY($2::uuid[]) AND read_at IS NULL
         RETURNING id`,
        [req.userId, capped]
      );
      res.json({ ok: true, updated: r.rowCount ?? 0, ids: r.rows.map((row: { id: string }) => row.id) });
    } catch (e) {
      console.error("[notifications bulk mark read]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  return app;
}

export function startNotificationHttpServer(port: number): void {
  const app = createNotificationHttpApp();
  app.listen(port, "0.0.0.0", () => console.log(`[notification HTTP] listening on ${port}`));
}
