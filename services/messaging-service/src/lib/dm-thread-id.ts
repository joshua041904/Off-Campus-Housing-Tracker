import { createHash } from "node:crypto";

/**
 * Namespace UUID for deterministic in-app human DM threads (RFC 4122 UUID v5).
 * Must match `infra/db/16-messaging-human-dm-thread-backfill.sql` (uuid_generate_v5).
 */
export const HUMAN_DM_NAMESPACE_UUID = "0cb1ee80-bfcd-4fb7-90c0-64e2c2dd3d1f";

const HUMAN_DM_NAMESPACE = HUMAN_DM_NAMESPACE_UUID;

function uuidStringToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("invalid_uuid_for_namespace");
  return Buffer.from(hex, "hex");
}

function bytesToUuidString(buf: Buffer): string {
  const h = buf.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * One stable conversation id for the same two users (order-independent).
 * Used for all non-booking direct messages between that pair.
 */
export function stableHumanDmThreadId(userA: string, userB: string): string {
  const a = String(userA || "")
    .trim()
    .toLowerCase();
  const b = String(userB || "")
    .trim()
    .toLowerCase();
  if (!a || !b) throw new Error("stableHumanDmThreadId: both user ids required");
  const [low, high] = a < b ? [a, b] : [b, a];
  const name = `dm:${low}:${high}`;
  const ns = uuidStringToBytes(HUMAN_DM_NAMESPACE);
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  const out = Buffer.alloc(16);
  hash.copy(out, 0, 0, 16);
  out[6] = (out[6]! & 0x0f) | 0x50; // version 5
  out[8] = (out[8]! & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuidString(out);
}

const BOOKING_TYPES = new Set(
  ["bookingnotice", "booking_notice", "bookingconfirmednotice", "booking_confirmed_notice", "system"].map((s) =>
    s.toLowerCase(),
  ),
);

export function isBookingOrSystemDirectMessage(messageType: string | undefined, content: string | undefined): boolean {
  const mt = String(messageType || "")
    .trim()
    .toLowerCase();
  if (BOOKING_TYPES.has(mt)) return true;
  const c = String(content || "")
    .trim()
    .toLowerCase();
  return c.startsWith("booking request created for listing");
}

/**
 * Postgres: deterministic human-DM conversation key from participant pair only (must match `stableHumanDmThreadId` / migration 16).
 * Use this for inbox grouping and thread fetch on **human** rows so corrupt per-message `thread_id` values cannot split one chat.
 */
export function sqlHumanPairConversationId(alias: string): string {
  const a = alias.trim();
  return `uuid_generate_v5(
      '${HUMAN_DM_NAMESPACE_UUID}'::uuid,
      'dm:' ||
      CASE WHEN ${a}.sender_id::text < ${a}.recipient_id::text THEN ${a}.sender_id::text ELSE ${a}.recipient_id::text END ||
      ':' ||
      CASE WHEN ${a}.sender_id::text < ${a}.recipient_id::text THEN ${a}.recipient_id::text ELSE ${a}.sender_id::text END
    )::text`;
}

/**
 * Postgres expression: row-level thread key for booking/system lines and legacy reads.
 * `thread_id` wins when set (e.g. BookingNotice uses booking_id); else pair-based v5.
 */
export function sqlHumanDirectConversationId(alias: string): string {
  const a = alias.trim();
  return `COALESCE(
    ${a}.thread_id::text,
    ${sqlHumanPairConversationId(a)}
  )`;
}

/** Row-level predicate: message is an in-app human DM line (not booking/system). */
export function sqlHumanDirectDmRow(alias: string): string {
  const a = alias.trim();
  return `(
    ${a}.group_id IS NULL
    AND ${a}.recipient_id IS NOT NULL
    AND COALESCE(${a}.message_type, '') NOT IN ('BookingNotice', 'booking_notice', 'BookingConfirmedNotice', 'booking_confirmed_notice', 'SYSTEM', 'System')
    AND NOT (COALESCE(lower(${a}.content), '') LIKE 'booking request created for listing%')
  )`;
}

/** Booking / system lines that belong in the Booking updates bucket (not human DM). */
export function sqlBookingOrSystemDmRow(alias: string): string {
  const a = alias.trim();
  return `(
    ${a}.group_id IS NULL
    AND (
      COALESCE(${a}.message_type, '') IN ('BookingNotice', 'booking_notice', 'BookingConfirmedNotice', 'booking_confirmed_notice', 'SYSTEM', 'System')
      OR COALESCE(lower(${a}.content), '') LIKE 'booking request created for listing%'
    )
  )`;
}
