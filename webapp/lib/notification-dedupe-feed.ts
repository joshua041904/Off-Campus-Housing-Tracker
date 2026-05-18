import type { NotificationItem } from "./api";
import {
  effectiveNotificationEventType,
  extractBookingNotificationShape,
  parseNotificationPayloadDeep,
} from "./notification-booking";
import {
  isUuidLike,
  mergeIdentityIntoPayload,
  payloadHasGoodBookingIdentity,
} from "./notification-booking-identity";

export { isUuidLike } from "./notification-booking-identity";

function isRealHandle(v: string): boolean {
  const s = v.trim().replace(/^@+/, "");
  if (!s || isUuidLike(s)) return false;
  return /^[a-z0-9_.-]{3,}$/i.test(s);
}

/** Raw identity strength from payload (0–40 per spec bands). */
export function notificationIdentityQualityFromPayload(p: Record<string, unknown>): number {
  const candidates = [
    p.renter_username,
    p.tenant_username_snapshot,
    p.tenant_username,
    p.renter_display_name,
    p.tenant_display_name,
    p.tenant_email,
    p.tenantEmail,
    p.tenant_id,
    p.renter_id,
  ]
    .filter((x) => x != null && String(x).trim())
    .map((x) => String(x).trim());

  if (candidates.some((v) => isRealHandle(v))) return 40;
  if (candidates.some((v) => v.includes("@"))) return 30;
  if (candidates.some((v) => v.trim().length > 1 && !isUuidLike(v))) return 20;
  if (candidates.some((v) => isUuidLike(v))) return 10;
  return 0;
}

export function notificationIdentityQuality(item: NotificationItem): number {
  return notificationIdentityQualityFromPayload(parseNotificationPayloadDeep(item));
}

export function notificationPayloadRichness(p: Record<string, unknown>): number {
  let n = 0;
  for (const v of Object.values(p)) {
    if (v == null) continue;
    if (typeof v === "string" && !String(v).trim()) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
    n += 1;
  }
  return Math.min(n, 80);
}

export function notificationDeepLinkQuality(item: NotificationItem, p?: Record<string, unknown>): number {
  const pl = p ?? parseNotificationPayloadDeep(item);
  const dl = String(pl.deep_link ?? pl.deepLink ?? "").trim();
  if (!dl) return 0;
  let s = 0;
  if (dl.includes("/dashboard/bookings/")) s += 2;
  if (/[?&]nid=/.test(dl)) s += 2;
  if (dl.length > 12) s += 1;
  return s;
}

/** >0 means a should win over b (richer / more useful merged row). */
export function compareNotificationMergePriority(a: NotificationItem, b: NotificationItem): number {
  const pa = parseNotificationPayloadDeep(a);
  const pb = parseNotificationPayloadDeep(b);
  const ia = notificationIdentityQualityFromPayload(pa);
  const ib = notificationIdentityQualityFromPayload(pb);
  if (ia !== ib) return ia - ib;
  const ra = a.read_at ? 1 : 0;
  const rb = b.read_at ? 1 : 0;
  if (ra !== rb) return ra - rb;
  const da = notificationDeepLinkQuality(a, pa);
  const db = notificationDeepLinkQuality(b, pb);
  if (da !== db) return da - db;
  const wa = notificationPayloadRichness(pa);
  const wb = notificationPayloadRichness(pb);
  if (wa !== wb) return wa - wb;
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function pickMergeWinner(group: NotificationItem[]): NotificationItem {
  return group.reduce((best, cur) => (compareNotificationMergePriority(cur, best) > 0 ? cur : best));
}

/** Context read: any sibling read_at makes the merged row read (earliest timestamp wins). */
export function mergeNotificationReadStateAcrossGroup(
  winner: NotificationItem,
  group: NotificationItem[],
): NotificationItem {
  const readTimes = group
    .map((g) => g.read_at)
    .filter((v): v is string => Boolean(v))
    .sort();
  const contextReadAt = readTimes[0];
  if (contextReadAt) {
    return { ...winner, read_at: winner.read_at ?? contextReadAt };
  }
  return { ...winner, read_at: undefined };
}

/** Propagate read_at to every notification row in the same booking context. */
export function applyBookingContextReadSyncToItems(items: NotificationItem[]): NotificationItem[] {
  const withBooking: NotificationItem[] = [];
  const withoutBooking: NotificationItem[] = [];
  for (const item of items) {
    const p = parseNotificationPayloadDeep(item);
    const { bookingId } = extractBookingNotificationShape(item, p);
    if (bookingId) withBooking.push(item);
    else withoutBooking.push(item);
  }
  const byBooking = new Map<string, NotificationItem[]>();
  for (const item of withBooking) {
    const p = parseNotificationPayloadDeep(item);
    const { bookingId } = extractBookingNotificationShape(item, p);
    if (!bookingId) continue;
    const g = byBooking.get(bookingId) ?? [];
    g.push(item);
    byBooking.set(bookingId, g);
  }
  const out: NotificationItem[] = [...withoutBooking];
  for (const group of Array.from(byBooking.values())) {
    const readTimes = group
      .map((g) => g.read_at)
      .filter((v): v is string => Boolean(v))
      .sort();
    const contextReadAt = readTimes[0];
    if (!contextReadAt) {
      out.push(...group);
      continue;
    }
    for (const item of group) {
      out.push(item.read_at ? item : { ...item, read_at: contextReadAt });
    }
  }
  return out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Stable collapse key: DB dedupe_key when set; else legacy composite so Kafka/HTTP duplicates
 * align even before backfill.
 */
export function notificationCollapseKey(item: NotificationItem, opts?: { recipientUserId?: string }): string {
  const dk = String(item.dedupe_key ?? "").trim();
  if (dk) return `dk:${dk}`;
  const uid = String(item.user_id ?? opts?.recipientUserId ?? "")
    .trim()
    .toLowerCase();
  const et = effectiveNotificationEventType(item).trim();
  const p = parseNotificationPayloadDeep(item);
  const audience = String(p.notification_audience ?? "").trim().toLowerCase();
  const category = String(p.notification_category ?? "").trim().toLowerCase();
  const { bookingId } = extractBookingNotificationShape(item, p);
  const contextType =
    String(p.context_type ?? "").trim().toLowerCase() || (bookingId ? "booking" : "");
  const contextId = String(p.context_id ?? bookingId ?? "")
    .trim()
    .toLowerCase();
  const st = String(p.booking_status ?? p.new_status ?? p.newStatus ?? item.status ?? "")
    .trim()
    .toUpperCase();
  if (bookingId || contextId) {
    return `lp:${uid}:${et}:${audience}:${category}:${contextType}:${contextId || bookingId}:${st}`;
  }
  return `row:${uid}:${item.id}`;
}

export function dedupeNotificationFeed(
  items: NotificationItem[],
  opts?: { recipientUserId?: string },
): NotificationItem[] {
  const groups = new Map<string, NotificationItem[]>();
  for (const it of items) {
    const k = notificationCollapseKey(it, opts);
    const arr = groups.get(k) ?? [];
    arr.push(it);
    groups.set(k, arr);
  }
  const winners: NotificationItem[] = [];
  for (const g of Array.from(groups.values())) {
    const w = pickMergeWinner(g);
    winners.push(mergeNotificationReadStateAcrossGroup(w, g));
  }
  return winners.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function landlordBookingLifecycleRank(item: NotificationItem): number {
  const p = parseNotificationPayloadDeep(item);
  const st = String(p.booking_status ?? p.new_status ?? p.newStatus ?? "").trim().toUpperCase();
  const et = effectiveNotificationEventType(item).toLowerCase();
  if (["CANCELLED", "CANCELED", "WITHDRAWN"].includes(st)) return 100;
  if (st === "REJECTED" || et.includes("reject")) return 100;
  if (st === "EXPIRED" || et.includes("expired")) return 100;
  if (st === "CONFIRMED" || et === "booking.confirmed") return 50;
  if (st === "ACCEPTED" || st === "PENDING_CONFIRMATION" || et === "booking.accepted") return 40;
  if (st === "PENDING" || et === "booking.created" || et.includes("request")) return 10;
  return 5;
}

/** >0 means a wins over b for landlord booking table (lifecycle first). */
export function compareLandlordBookingContextPriority(a: NotificationItem, b: NotificationItem): number {
  const la = landlordBookingLifecycleRank(a);
  const lb = landlordBookingLifecycleRank(b);
  if (la !== lb) return la - lb;
  return compareNotificationMergePriority(a, b);
}

function pickLandlordBookingContextWinner(group: NotificationItem[]): NotificationItem {
  return group.reduce((best, cur) => (compareLandlordBookingContextPriority(cur, best) > 0 ? cur : best));
}

function pickBestIdentityRowInGroup(group: NotificationItem[]): NotificationItem {
  return group.reduce((best, cur) =>
    compareNotificationMergePriority(cur, best) > 0 ? cur : best,
  );
}

/**
 * One display row per booking: lifecycle/status from highest-rank row; identity merged from
 * the best-enriched row in the same booking context (e.g. confirmed + @handle from created).
 */
export function mergeBookingContextDisplayNotification(group: NotificationItem[]): NotificationItem {
  if (group.length === 0) {
    throw new Error("mergeBookingContextDisplayNotification requires at least one item");
  }
  if (group.length === 1) return group[0];

  const lifecycleWinner = pickLandlordBookingContextWinner(group);
  const identityWinner = pickBestIdentityRowInGroup(group);
  const lifecyclePayload = parseNotificationPayloadDeep(lifecycleWinner);
  const identityPayload = parseNotificationPayloadDeep(identityWinner);
  const mergedPayload = mergeIdentityIntoPayload(lifecyclePayload, identityPayload);

  const withMergedPayload: NotificationItem = {
    ...lifecycleWinner,
    payload: mergedPayload,
  };
  return mergeNotificationReadStateAcrossGroup(withMergedPayload, group);
}

/**
 * Landlord dashboard: one visible row per booking — prefer terminal / confirmed over stale
 * `booking.created`, then identity-rich payload, read state, etc.
 */
export function collapseLandlordBookingNotificationsByBookingId(items: NotificationItem[]): NotificationItem[] {
  const withBooking: NotificationItem[] = [];
  const withoutBooking: NotificationItem[] = [];
  for (const it of items) {
    const p = parseNotificationPayloadDeep(it);
    const { bookingId } = extractBookingNotificationShape(it, p);
    if (bookingId) withBooking.push(it);
    else withoutBooking.push(it);
  }
  const byBooking = new Map<string, NotificationItem[]>();
  for (const it of withBooking) {
    const p = parseNotificationPayloadDeep(it);
    const { bookingId } = extractBookingNotificationShape(it, p);
    const k = bookingId.toLowerCase();
    const g = byBooking.get(k) ?? [];
    g.push(it);
    byBooking.set(k, g);
  }
  const collapsed: NotificationItem[] = [...withoutBooking];
  for (const g of Array.from(byBooking.values())) {
    collapsed.push(mergeBookingContextDisplayNotification(g));
  }
  return collapsed.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export { payloadHasGoodBookingIdentity };
