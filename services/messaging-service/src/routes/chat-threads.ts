import type { Response } from "express";
import type { AuthedRequest } from "../lib/auth.js";
import { pool } from "../lib/db.js";
import {
  sqlBookingOrSystemDmRow,
  sqlHumanDirectConversationId,
  sqlHumanDirectDmRow,
  sqlHumanPairConversationId,
} from "../lib/dm-thread-id.js";

const SUBJECT_LISTING = /^\[listing:([0-9a-f-]{36})\]\s*(.*)$/i;
const RE_PREFIX = /^re:\s*/i;
const THREAD_NOISE_PREFIX = /^thread\s+[0-9a-f-]{8,}/i;
const INTEGRATION_NOISE = /\b(seed(ed|ing)?|integration|fixture|RICH-LISTING-MARKER|FV\s+listing|batch)\b/i;

function normalizeSubject(raw: string): string {
  let s = String(raw || "").trim();
  s = s.replace(RE_PREFIX, "").trim();
  s = s.replace(THREAD_NOISE_PREFIX, "").trim();
  return s;
}

function cleanListingContextTitle(raw: string): string {
  const s = normalizeSubject(raw);
  if (!s) return "";
  if (/^(booking request created for listing|och-page-\d+-)/i.test(s)) return "";
  return s.slice(0, 160);
}

function scrubUserFacingTitle(raw: string): string {
  const base = cleanListingContextTitle(raw);
  if (!base) return "";
  if (INTEGRATION_NOISE.test(base)) return "Listing";
  const stripped = base.replace(/\b\d{10,}\b\s*$/u, "").trim();
  if (INTEGRATION_NOISE.test(stripped)) return "Listing";
  return stripped.slice(0, 160);
}

function cleanPreview(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^booking request created for listing/i.test(s)) return "Booking update";
  if (INTEGRATION_NOISE.test(s) || /\bseeded\b/i.test(s)) return "Listing update";
  return s.slice(0, 160);
}

function participantDisplayLine(
  kind: string,
  groupSubject: string,
  displayName: string | null | undefined,
  username: string | null | undefined,
): string {
  if (kind === "group") {
    const g = normalizeSubject(groupSubject);
    return g || "Group";
  }
  const d = String(displayName || "").trim();
  if (d && !/^conversation$/i.test(d)) return d.slice(0, 120);
  const u = String(username || "").trim().replace(/^@+/, "");
  if (u) return u.slice(0, 120);
  return "";
}

/** Avoid generic inbox titles like "Conversation" / empty DM bucket labels. */
function humanInboxTitle(
  participantLine: string,
  listingContextTitle: string,
  kind: string,
  usernameFallback?: string | null,
): string {
  const p = String(participantLine || "").trim();
  if (p && !/^conversation$/i.test(p) && !/^direct message$/i.test(p)) return p.slice(0, 120);
  const loc = String(listingContextTitle || "").trim();
  if (loc && !/^listing$/i.test(loc)) return loc.slice(0, 120);
  if (kind === "group") return "Group";
  const u = String(usernameFallback || "")
    .trim()
    .replace(/^@+/, "");
  if (u) return `@${u}`.slice(0, 120);
  return "New messages";
}

type ThreadRow = {
  id: string;
  kind?: string | null;
  last_at?: string | null;
  subject: string | null;
  anchor_subject: string | null;
  last_preview: string | null;
  unread_count?: number | null;
  counterpart_display_name?: string | null;
  counterpart_username?: string | null;
  note_to_self?: boolean | null;
};

function mapThreadRow(
  r: ThreadRow,
  role: "direct" | "booking_update",
): Record<string, unknown> {
  const rawSubject = String(r.subject || "");
  const anchor = String(r.anchor_subject || rawSubject || "");
  const subjectForMeta = /^conversation$/i.test(normalizeSubject(anchor)) ? rawSubject : anchor;
  const kind = String(r.kind || "dm").toLowerCase() === "group" ? "group" : "dm";
  const participantLine = participantDisplayLine(
    kind,
    rawSubject,
    r.counterpart_display_name,
    r.counterpart_username,
  );
  const lm = subjectForMeta.match(SUBJECT_LISTING);
  const listingId = lm?.[1]?.trim() || null;
  const listingTitleFromSubject = scrubUserFacingTitle(String(lm?.[2] || "").trim());
  const listingContextTitle =
    listingTitleFromSubject || (listingId ? "Listing" : kind === "group" ? "" : "");
  const noteToSelf = Boolean(r.note_to_self);
  const participantDisplay = noteToSelf
    ? "Notes to self"
    : humanInboxTitle(participantLine, listingContextTitle, kind, r.counterpart_username);
  const previewBase = String(r.last_preview || "").trim() || rawSubject;
  const lastMessagePreview =
    cleanPreview(previewBase) || (kind === "group" ? "Group chat" : "No messages yet");
  return {
    id: r.id,
    kind,
    threadRole: role,
    participantDisplay,
    participantDisplayName: r.counterpart_display_name ?? null,
    participantUsername: r.counterpart_username ?? null,
    listingId,
    listingContextTitle: listingContextTitle || null,
    lastMessagePreview,
    unreadCount: Number(r.unread_count || 0),
    lastAt: r.last_at,
    listingTitle: participantDisplay,
  };
}

const DM_CONV_ID = sqlHumanPairConversationId("m");

const DM_BASE_HEAD = `SELECT
           ${DM_CONV_ID} AS id,
           'dm'::text AS kind,
           MAX(m.created_at) AS last_at,
           (array_agg(m.subject ORDER BY m.created_at DESC))[1] AS subject,
           (array_agg(m.subject ORDER BY m.created_at ASC))[1] AS anchor_subject,
           SUBSTRING((array_agg(m.content ORDER BY m.created_at DESC) FILTER (WHERE m.content IS NOT NULL))[1] FOR 140) AS last_preview,
            (array_agg(
              CASE WHEN m.sender_id = $1::uuid THEN m.recipient_id::text ELSE m.sender_id::text END
              ORDER BY m.created_at DESC
            ))[1] AS counterpart_user_id,
           COUNT(*) FILTER (
             WHERE m.recipient_id = $1::uuid AND COALESCE(m.is_read, false) = false
           )::int AS unread_count,
           BOOL_OR(m.sender_id IS NOT NULL AND m.sender_id = m.recipient_id) AS note_to_self
         FROM messages.messages m
         WHERE (m.sender_id = $1::uuid OR m.recipient_id = $1::uuid)
           AND m.group_id IS NULL`;

const DM_BASE_GROUP = `GROUP BY 1`;

async function fetchDmThreads(userId: string, mode: "human" | "booking"): Promise<ThreadRow[]> {
  /** Split strictly: any thread that ever contains a booking/system line stays out of the DM inbox. */
  const bookingThreadIds = `SELECT DISTINCT ${sqlHumanDirectConversationId("b")} AS tid
     FROM messages.messages b
     WHERE (b.sender_id = $1::uuid OR b.recipient_id = $1::uuid)
       AND b.group_id IS NULL
       AND ${sqlBookingOrSystemDmRow("b")}`;
  const modeRowFilter = mode === "human" ? `AND ${sqlHumanDirectDmRow("m")}` : `AND ${sqlBookingOrSystemDmRow("m")}`;
  const threadFilter =
    mode === "human"
      ? `AND ${DM_CONV_ID} NOT IN (${bookingThreadIds})`
      : `AND ${DM_CONV_ID} IN (${bookingThreadIds})`;
  const { rows } = await pool.query(
    `WITH dm AS (
         ${DM_BASE_HEAD}
         ${modeRowFilter}
         ${threadFilter}
         ${DM_BASE_GROUP}
       )
       SELECT
         u.id, u.kind, u.last_at, u.subject, u.anchor_subject, u.last_preview, u.unread_count,
         NULLIF(TRIM(COALESCE(au.display_name::text, '')), '') AS counterpart_display_name,
         NULLIF(TRIM(COALESCE(au.display_username::text, '')), '') AS counterpart_username,
         u.note_to_self
       FROM dm u
       LEFT JOIN auth.users au ON au.id::text = u.counterpart_user_id
       ORDER BY last_at DESC
       LIMIT 50`,
    [userId],
  );
  return rows as ThreadRow[];
}

async function fetchGroupThreads(userId: string): Promise<ThreadRow[]> {
  const { rows } = await pool.query(
    `WITH grp AS (
         SELECT
           g.id::text AS id,
           'group'::text AS kind,
           COALESCE(MAX(m.created_at), to_timestamp(0)) AS last_at,
           COALESCE(NULLIF(TRIM(g.name), ''), 'Group chat') AS subject,
           COALESCE(NULLIF(TRIM(g.name), ''), 'Group chat') AS anchor_subject,
           SUBSTRING((array_agg(m.content ORDER BY m.created_at DESC) FILTER (WHERE m.content IS NOT NULL))[1] FOR 140) AS last_preview,
           NULL::text AS counterpart_user_id,
           COUNT(*) FILTER (
             WHERE m.recipient_id = $1::uuid AND COALESCE(m.is_read, false) = false
           )::int AS unread_count
         FROM messages.group_members gm
         INNER JOIN messages.groups g ON g.id = gm.group_id
         LEFT JOIN messages.messages m ON m.group_id = g.id
         WHERE gm.user_id = $1::uuid
         GROUP BY g.id, g.name
       )
       SELECT
         u.id, u.kind, u.last_at, u.subject, u.anchor_subject, u.last_preview, u.unread_count,
         NULL::text AS counterpart_display_name,
         NULL::text AS counterpart_username
       FROM grp u
       ORDER BY last_at DESC
       LIMIT 50`,
    [userId],
  );
  return rows as ThreadRow[];
}

/** GET /threads — inbox-style thread list for dashboard (auth: gateway x-user-id). */
export async function getChatThreadsList(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.userId!;
  try {
    const email = String(req.userEmail || "").trim();
    if (email) {
      const local = email.includes("@") ? email.split("@")[0].slice(0, 64) : email.slice(0, 64);
      const sqlWithUsername = `INSERT INTO auth.users (id, email, display_username, username)
           VALUES ($1::uuid, $2, $3, $3)
           ON CONFLICT (id) DO UPDATE SET
             email = COALESCE(EXCLUDED.email, auth.users.email),
             display_username = COALESCE(
               NULLIF(TRIM(auth.users.display_username), ''),
               EXCLUDED.display_username
             ),
             username = COALESCE(NULLIF(TRIM(auth.users.username), ''), EXCLUDED.username)`;
      const sqlLegacy = `INSERT INTO auth.users (id, email, display_username)
           VALUES ($1::uuid, $2, $3)
           ON CONFLICT (id) DO UPDATE SET
             email = COALESCE(EXCLUDED.email, auth.users.email),
             display_username = COALESCE(
               NULLIF(TRIM(auth.users.display_username), ''),
               EXCLUDED.display_username
             )`;
      const params = [userId, email, local];
      try {
        await pool.query(sqlWithUsername, params);
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === "42P01") {
          /* auth.users not present in this DB — continue to thread list */
        } else if (code === "42703") {
          try {
            await pool.query(sqlLegacy, params);
          } catch (e2: unknown) {
            const c2 = (e2 as { code?: string })?.code;
            if (c2 !== "42P01") throw e2;
          }
        } else {
          throw e;
        }
      }
    }

    const [humanDm, bookingDm, groups] = await Promise.all([
      fetchDmThreads(userId, "human"),
      fetchDmThreads(userId, "booking"),
      fetchGroupThreads(userId),
    ]);

    const humanRows = [...humanDm, ...groups].sort((a, b) => {
      const ta = new Date(String(a.last_at || 0)).getTime();
      const tb = new Date(String(b.last_at || 0)).getTime();
      return tb - ta;
    });

    const threads = humanRows.slice(0, 50).map((r) => mapThreadRow(r, "direct"));
    const bookingUpdates = bookingDm.map((r) => mapThreadRow(r, "booking_update"));

    res.json({ threads, bookingUpdates });
  } catch (err) {
    console.error("[messaging] GET /threads failed", err);
    res.status(500).json({ error: "Failed to list threads" });
  }
}

/** GET /messages/unread-count — same unread semantics as thread list (DM + booking + group). */
export async function getMessagingUnreadCountHandler(req: AuthedRequest, res: Response): Promise<void> {
  const userId = req.userId!;
  try {
    const [humanDm, bookingDm, groups] = await Promise.all([
      fetchDmThreads(userId, "human"),
      fetchDmThreads(userId, "booking"),
      fetchGroupThreads(userId),
    ]);
    let unread = 0;
    for (const r of [...humanDm, ...bookingDm, ...groups]) {
      unread += Number(r.unread_count || 0);
    }
    res.json({ unread_count: unread });
  } catch (err) {
    console.error("[messaging] GET /messages/unread-count failed", err);
    res.status(500).json({ error: "Failed to load unread count" });
  }
}
