#!/usr/bin/env npx tsx
/**
 * Consolidate duplicate auth identities into one canonical user (idempotent).
 *
 * Dry-run (default):
 *   pnpm exec tsx scripts/repair-restored-user-ownership.ts \
 *     --canonical-user-id 1b235322-10e5-4cfb-8594-6565e67e28e9 \
 *     --canonical-email tomwang04312@gmail.com \
 *     --match-username tomwang04312 \
 *     --include-user-id ee55ecc0-617b-4d48-b350-61c08adcb3e2 \
 *     --include-user-id 9f9a9df4-9211-460f-a00d-dd40a523a488 \
 *     --include-user-id d9206c11-7afd-41bd-8b53-f85410f473b4
 *
 * Apply:
 *   ...same args... --apply
 *
 * JSON dry-run report:
 *   ... --dry-run-json /tmp/consolidation-dry-run.json
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import pg from "pg";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const URLS = {
  auth: process.env.POSTGRES_URL_AUTH ?? "postgresql://postgres:postgres@127.0.0.1:5441/auth",
  bookings:
    process.env.POSTGRES_URL_BOOKINGS ?? "postgresql://postgres:postgres@127.0.0.1:5443/bookings",
  listings:
    process.env.POSTGRES_URL_LISTINGS ?? "postgresql://postgres:postgres@127.0.0.1:5442/listings",
  notification:
    process.env.POSTGRES_URL_NOTIFICATION ??
    "postgresql://postgres:postgres@127.0.0.1:5445/notification",
  messaging:
    process.env.POSTGRES_URL_MESSAGING ??
    "postgresql://postgres:postgres@127.0.0.1:5444/messaging",
  trust: process.env.POSTGRES_URL_TRUST ?? "postgresql://postgres:postgres@127.0.0.1:5446/trust",
};

const GENERATED_USERNAME_SUFFIX_RE =
  /^(.+?)_(?:[0-9a-f]{8,32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

type Cli = {
  apply: boolean;
  dryRunJson?: string;
  canonicalUserId: string;
  canonicalEmail: string;
  matchUsername: string;
  includeUserIds: string[];
  skipRedis: boolean;
};

type AuthUser = {
  id: string;
  email: string;
  username: string;
  display_username: string | null;
  display_name: string | null;
  created_at: string;
};

type TableChange = {
  database: string;
  schema: string;
  table: string;
  column: string;
  rowCount: number;
  sampleIds: string[];
};

type RepairPlan = {
  runId: string;
  canonical: AuthUser;
  sources: AuthUser[];
  excluded: Array<{ user: AuthUser; reason: string }>;
  changes: TableChange[];
  warnings: string[];
};

function parseCli(argv: string[]): Cli {
  const includeUserIds: string[] = [];
  let apply = false;
  let dryRunJson: string | undefined;
  let canonicalUserId = "";
  let canonicalEmail = "";
  let matchUsername = "";
  let skipRedis = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--skip-redis") skipRedis = true;
    else if (a === "--dry-run-json") dryRunJson = argv[++i];
    else if (a === "--canonical-user-id") canonicalUserId = String(argv[++i] ?? "").trim().toLowerCase();
    else if (a === "--canonical-email") canonicalEmail = String(argv[++i] ?? "").trim().toLowerCase();
    else if (a === "--match-username") matchUsername = String(argv[++i] ?? "").trim();
    else if (a === "--include-user-id") {
      const id = String(argv[++i] ?? "").trim().toLowerCase();
      if (UUID_RE.test(id)) includeUserIds.push(id);
    }
  }

  if (argv.some((a) => a.includes("same args"))) {
    throw new Error(
      'Replace the placeholder "...same args..." with real flags, or run: ./scripts/repair-tomwang-consolidation.sh [--apply]',
    );
  }
  if (!UUID_RE.test(canonicalUserId)) {
    throw new Error(
      "--canonical-user-id <uuid> is required (example: ./scripts/repair-tomwang-consolidation.sh --apply)",
    );
  }
  if (!canonicalEmail) throw new Error("--canonical-email is required");
  if (!matchUsername) throw new Error("--match-username is required");

  return {
    apply,
    dryRunJson,
    canonicalUserId,
    canonicalEmail,
    matchUsername,
    includeUserIds,
    skipRedis,
  };
}

function cleanUsernameBase(username: string): string {
  let raw = username.trim().replace(/^@+/, "");
  for (let i = 0; i < 4; i += 1) {
    const match = raw.match(GENERATED_USERNAME_SUFFIX_RE);
    if (!match?.[1]) break;
    raw = match[1];
  }
  return raw.slice(0, 64).toLowerCase();
}

function matchesUsernameFamily(value: string, base: string): boolean {
  const snap = value.trim().replace(/^@+/, "").toLowerCase();
  const b = base.toLowerCase();
  if (!snap || !b) return false;
  return snap === b || snap.startsWith(`${b}_`);
}

function isAutoMergeableUser(user: AuthUser, matchBase: string, canonicalEmail: string): boolean {
  const email = user.email.trim().toLowerCase();
  const uname = String(user.username ?? "").trim();
  const display = String(user.display_username ?? user.display_name ?? "").trim();
  if (email === canonicalEmail) return true;
  if (matchesUsernameFamily(uname, matchBase)) return true;
  if (matchesUsernameFamily(display, matchBase)) return true;
  if (email.includes(`${matchBase.toLowerCase()}@`)) return true;
  if (email.endsWith("@example.com") && matchesUsernameFamily(email.split("@")[0] ?? "", matchBase)) {
    return true;
  }
  return false;
}

async function ensureSnapshotSchema(authPool: pg.Pool): Promise<void> {
  await authPool.query(`
    CREATE SCHEMA IF NOT EXISTS repair;
    CREATE TABLE IF NOT EXISTS repair.consolidation_row_snapshots (
      snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      canonical_user_id UUID NOT NULL,
      source_user_id UUID NOT NULL,
      target_database TEXT NOT NULL,
      target_schema TEXT NOT NULL,
      target_table TEXT NOT NULL,
      row_pk JSONB NOT NULL,
      before_data JSONB NOT NULL
    );
  `);
}

async function loadAuthUser(pool: pg.Pool, id: string): Promise<AuthUser | null> {
  const { rows } = await pool.query<AuthUser>(
    `SELECT id::text AS id,
            COALESCE(email::text, '') AS email,
            COALESCE(username::text, '') AS username,
            display_username::text AS display_username,
            display_name::text AS display_name,
            created_at::text AS created_at
     FROM auth.users
     WHERE id = $1::uuid`,
    [id],
  );
  return rows[0] ?? null;
}

async function discoverAuthCandidates(
  pool: pg.Pool,
  matchUsername: string,
): Promise<AuthUser[]> {
  const base = cleanUsernameBase(matchUsername);
  const { rows } = await pool.query<AuthUser>(
    `SELECT id::text AS id,
            COALESCE(email::text, '') AS email,
            COALESCE(username::text, '') AS username,
            display_username::text AS display_username,
            display_name::text AS display_name,
            created_at::text AS created_at
     FROM auth.users
     WHERE lower(email) LIKE '%' || $1 || '%'
        OR lower(username::text) LIKE '%' || $1 || '%'
        OR lower(COALESCE(display_username::text, '')) LIKE '%' || $1 || '%'
        OR lower(COALESCE(display_name::text, '')) LIKE '%' || $1 || '%'
     ORDER BY created_at`,
    [base],
  );
  return rows;
}

async function discoverBookingTenantUserIds(
  pool: pg.Pool,
  matchUsername: string,
): Promise<string[]> {
  const base = cleanUsernameBase(matchUsername);
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT DISTINCT tenant_id::text AS user_id
     FROM booking.bookings
     WHERE tenant_username_snapshot ILIKE '%' || $1 || '%'`,
    [base],
  );
  return rows.map((r) => r.user_id.toLowerCase()).filter((id) => UUID_RE.test(id));
}

async function resolveSources(
  authPool: pg.Pool,
  canonical: AuthUser,
  candidates: AuthUser[],
  bookingTenantIds: string[],
  cli: Cli,
): Promise<{ sources: AuthUser[]; excluded: Array<{ user: AuthUser; reason: string }> }> {
  const matchBase = cleanUsernameBase(cli.matchUsername);
  const explicit = new Set(cli.includeUserIds.map((id) => id.toLowerCase()));
  const byId = new Map<string, AuthUser>();
  for (const u of candidates) byId.set(u.id.toLowerCase(), u);

  for (const id of bookingTenantIds) {
    if (!byId.has(id) && explicit.has(id)) {
      byId.set(id, {
        id,
        email: "",
        username: "",
        display_username: null,
        display_name: null,
        created_at: "",
      });
    }
  }

  const sources: AuthUser[] = [];
  const excluded: Array<{ user: AuthUser; reason: string }> = [];

  for (const id of explicit) {
    if (id === canonical.id.toLowerCase()) continue;
    let user = byId.get(id);
    if (!user) {
      user = (await loadAuthUser(authPool, id)) ?? undefined;
      if (user) byId.set(id, user);
    }
    if (!user) {
      excluded.push({
        user: {
          id,
          email: "?",
          username: "?",
          display_username: null,
          display_name: null,
          created_at: "",
        },
        reason: "--include-user-id not found in auth.users",
      });
      continue;
    }
    sources.push(user);
  }

  for (const user of candidates) {
    const id = user.id.toLowerCase();
    if (id === canonical.id.toLowerCase()) continue;
    if (sources.some((s) => s.id.toLowerCase() === id)) continue;
    if (explicit.has(id)) continue;

    if (isAutoMergeableUser(user, matchBase, cli.canonicalEmail)) {
      sources.push(user);
      continue;
    }
    excluded.push({
      user,
      reason: "email/username does not match tomwang04312 family (pass --include-user-id to force)",
    });
  }

  const uniq = new Map<string, AuthUser>();
  for (const s of sources) uniq.set(s.id.toLowerCase(), s);
  return { sources: Array.from(uniq.values()), excluded };
}

async function countRows(
  pool: pg.Pool,
  sql: string,
  params: unknown[],
): Promise<{ count: number; sampleIds: string[] }> {
  const countSql = `SELECT count(*)::int AS n FROM (${sql}) q`;
  const sampleSql = `SELECT q.id::text AS id FROM (${sql}) q LIMIT 8`;
  const [countRes, sampleRes] = await Promise.all([
    pool.query<{ n: number }>(countSql, params),
    pool.query<{ id: string }>(sampleSql, params),
  ]);
  return {
    count: countRes.rows[0]?.n ?? 0,
    sampleIds: sampleRes.rows.map((r) => r.id),
  };
}

async function buildPlan(
  pools: Record<string, pg.Pool>,
  cli: Cli,
  canonical: AuthUser,
  sources: AuthUser[],
  excluded: Array<{ user: AuthUser; reason: string }>,
): Promise<RepairPlan> {
  const sourceIds = sources.map((s) => s.id);
  const canonicalId = canonical.id;
  const changes: TableChange[] = [];
  const warnings: string[] = [];

  if (sourceIds.length === 0) warnings.push("No source user ids to merge.");

  const bookings = pools.bookings;
  const listings = pools.listings;
  const notification = pools.notification;
  const messaging = pools.messaging;
  const trust = pools.trust;

  const tenantBookings = await countRows(
    bookings,
    `SELECT id FROM booking.bookings WHERE tenant_id = ANY($1::uuid[])`,
    [sourceIds],
  );
  changes.push({
    database: "bookings",
    schema: "booking",
    table: "bookings",
    column: "tenant_id",
    rowCount: tenantBookings.count,
    sampleIds: tenantBookings.sampleIds,
  });

  const landlordBookings = await countRows(
    bookings,
    `SELECT id FROM booking.bookings WHERE landlord_id = ANY($1::uuid[])`,
    [sourceIds],
  );
  changes.push({
    database: "bookings",
    schema: "booking",
    table: "bookings",
    column: "landlord_id",
    rowCount: landlordBookings.count,
    sampleIds: landlordBookings.sampleIds,
  });

  for (const [table, col] of [
    ["search_history", "user_id"],
    ["watchlist_items", "user_id"],
  ] as const) {
    const r = await countRows(
      bookings,
      `SELECT id FROM booking.${table} WHERE ${col} = ANY($1::uuid[])`,
      [sourceIds],
    );
    changes.push({
      database: "bookings",
      schema: "booking",
      table,
      column: col,
      rowCount: r.count,
      sampleIds: r.sampleIds,
    });
  }

  const listingOwners = await countRows(
    listings,
    `SELECT id FROM listings.listings WHERE user_id = ANY($1::uuid[])`,
    [sourceIds],
  );
  changes.push({
    database: "listings",
    schema: "listings",
    table: "listings",
    column: "user_id",
    rowCount: listingOwners.count,
    sampleIds: listingOwners.sampleIds,
  });

  for (const [table, col] of [
    ["community_posts", "author_id"],
    ["community_comments", "author_id"],
    ["community_post_votes", "user_id"],
    ["community_comment_votes", "user_id"],
  ] as const) {
    const exists = await listings.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'listings' AND table_name = $1`,
      [table],
    );
    if (!exists.rowCount) continue;
    const pkExpr =
      table === "community_post_votes"
        ? "post_id"
        : table === "community_comment_votes"
          ? "comment_id"
          : "id";
    const r = await countRows(
      listings,
      `SELECT ${pkExpr} AS id FROM listings.${table} WHERE ${col} = ANY($1::uuid[])`,
      [sourceIds],
    );
    changes.push({
      database: "listings",
      schema: "listings",
      table,
      column: col,
      rowCount: r.count,
      sampleIds: r.sampleIds,
    });
  }

  const notifUser = await countRows(
    notification,
    `SELECT id FROM notification.notifications WHERE user_id = ANY($1::uuid[])`,
    [sourceIds],
  );
  changes.push({
    database: "notification",
    schema: "notification",
    table: "notifications",
    column: "user_id",
    rowCount: notifUser.count,
    sampleIds: notifUser.sampleIds,
  });

  const msgParticipants = await countRows(
    messaging,
    `SELECT conversation_id::text || ':' || user_id::text AS id
     FROM messaging.conversation_participants
     WHERE user_id = ANY($1::uuid[])`,
    [sourceIds],
  );
  changes.push({
    database: "messaging",
    schema: "messaging",
    table: "conversation_participants",
    column: "user_id",
    rowCount: msgParticipants.count,
    sampleIds: msgParticipants.sampleIds,
  });

  const msgSenders = await countRows(
    messaging,
    `SELECT id FROM messaging.messages WHERE sender_id = ANY($1::uuid[])`,
    [sourceIds],
  );
  changes.push({
    database: "messaging",
    schema: "messaging",
    table: "messages",
    column: "sender_id",
    rowCount: msgSenders.count,
    sampleIds: msgSenders.sampleIds,
  });

  for (const [tableName, col] of [
    ["reviews", "reviewer_id"],
    ["user_flags", "user_id"],
    ["reputation", "user_id"],
    ["user_suspensions", "user_id"],
  ] as const) {
    const exists = await trust.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'trust' AND table_name = $1`,
      [tableName],
    );
    if (!exists.rowCount) continue;
    const pk = tableName === "reputation" ? "user_id" : "id";
    const r = await countRows(
      trust,
      `SELECT ${pk} AS id FROM trust.${tableName} WHERE ${col} = ANY($1::uuid[])`,
      [sourceIds],
    );
    changes.push({
      database: "trust",
      schema: "trust",
      table: tableName,
      column: col,
      rowCount: r.count,
      sampleIds: r.sampleIds,
    });
  }

  return {
    runId: randomUUID(),
    canonical,
    sources,
    excluded,
    changes,
    warnings,
  };
}

async function snapshotRows(
  authPool: pg.Pool,
  runId: string,
  canonicalId: string,
  sourceId: string,
  database: string,
  schema: string,
  table: string,
  rows: Array<{ pk: Record<string, unknown>; before: Record<string, unknown> }>,
): Promise<void> {
  if (!rows.length) return;
  const values: unknown[] = [];
  const chunks: string[] = [];
  let i = 1;
  for (const row of rows) {
    chunks.push(
      `($${i++}::uuid, $${i++}::uuid, $${i++}::uuid, $${i++}, $${i++}, $${i++}, $${i++}::jsonb, $${i++}::jsonb)`,
    );
    values.push(
      runId,
      canonicalId,
      sourceId,
      database,
      schema,
      table,
      JSON.stringify(row.pk),
      JSON.stringify(row.before),
    );
  }
  await authPool.query(
    `INSERT INTO repair.consolidation_row_snapshots
       (run_id, canonical_user_id, source_user_id, target_database, target_schema, target_table, row_pk, before_data)
     VALUES ${chunks.join(", ")}`,
    values,
  );
}

async function applyBookings(
  pool: pg.Pool,
  authPool: pg.Pool,
  plan: RepairPlan,
  canonicalId: string,
  sourceIds: string[],
  canonicalUsername: string,
  apply: boolean,
): Promise<void> {
  const snapTenant = await pool.query(
    `SELECT id::text AS id, tenant_id::text AS tenant_id, tenant_username_snapshot, row_to_json(b.*)::jsonb AS row_json
     FROM booking.bookings b
     WHERE tenant_id = ANY($1::uuid[])`,
    [sourceIds],
  );
  if (apply) {
    await snapshotRows(
      authPool,
      plan.runId,
      canonicalId,
      sourceIds[0] ?? canonicalId,
      "bookings",
      "booking",
      "bookings",
      snapTenant.rows.map((r) => ({
        pk: { id: r.id },
        before: r.row_json as Record<string, unknown>,
      })),
    );
    await pool.query(
      `UPDATE booking.bookings
       SET tenant_id = $1::uuid,
           tenant_username_snapshot = $2,
           updated_at = now()
       WHERE tenant_id = ANY($3::uuid[])`,
      [canonicalId, canonicalUsername, sourceIds],
    );
    await pool.query(
      `UPDATE booking.bookings
       SET tenant_username_snapshot = $2,
           updated_at = now()
       WHERE tenant_id = $1::uuid
         AND (
           tenant_username_snapshot IS NULL
           OR trim(tenant_username_snapshot) = ''
           OR tenant_username_snapshot NOT ILIKE $3
         )`,
      [canonicalId, canonicalUsername, `${canonicalUsername}%`],
    );
    const snapLandlord = await pool.query(
      `SELECT id::text AS id, row_to_json(b.*)::jsonb AS row_json
       FROM booking.bookings b WHERE landlord_id = ANY($1::uuid[])`,
      [sourceIds],
    );
    await snapshotRows(
      authPool,
      plan.runId,
      canonicalId,
      sourceIds[0] ?? canonicalId,
      "bookings",
      "booking",
      "bookings_landlord",
      snapLandlord.rows.map((r) => ({
        pk: { id: r.id },
        before: r.row_json as Record<string, unknown>,
      })),
    );
    await pool.query(
      `UPDATE booking.bookings SET landlord_id = $1::uuid, updated_at = now()
       WHERE landlord_id = ANY($2::uuid[])`,
      [canonicalId, sourceIds],
    );
    for (const table of ["search_history", "watchlist_items"] as const) {
      await pool.query(
        `UPDATE booking.${table} SET user_id = $1::uuid WHERE user_id = ANY($2::uuid[])`,
        [canonicalId, sourceIds],
      );
    }
    await pool.query(
      `DELETE FROM booking.watchlist_items a
       USING booking.watchlist_items b
       WHERE a.user_id = $1::uuid AND b.user_id = $1::uuid
         AND a.listing_id = b.listing_id
         AND a.ctid < b.ctid`,
      [canonicalId],
    );
  }
}

async function applyNotifications(
  pool: pg.Pool,
  canonicalId: string,
  sourceIds: string[],
  apply: boolean,
): Promise<number> {
  if (!apply) return 0;
  const moved = await pool.query(
    `UPDATE notification.notifications
     SET user_id = $1::uuid
     WHERE user_id = ANY($2::uuid[])
     RETURNING id`,
    [canonicalId, sourceIds],
  );
  await pool.query(
    `UPDATE notification.notifications n
     SET payload = jsonb_set(
           jsonb_set(
             jsonb_set(COALESCE(payload, '{}'::jsonb), '{tenant_id}', to_jsonb($1::text), true),
             '{tenantId}', to_jsonb($1::text), true
           ),
           '{renter_id}', to_jsonb($1::text), true
         )
     WHERE COALESCE(payload->>'tenant_id', payload->>'tenantId', payload->>'renter_id', '') = ANY($2::text[])`,
    [canonicalId, sourceIds],
  );
  await pool.query(
    `UPDATE notification.notifications n
     SET dedupe_key = 'notification:booking:' || $1::text || ':' ||
       LOWER(COALESCE(
         NULLIF(payload->>'context_id', ''),
         NULLIF(payload->>'booking_id', ''),
         NULLIF(payload->>'bookingId', '')
       )) || ':' || COALESCE(NULLIF(event_type, ''), 'booking.event')
     WHERE (
       COALESCE(payload->>'category', '') = 'booking'
       OR COALESCE(payload->>'notification_category', '') IN ('booking_renter', 'booking_landlord')
       OR event_type LIKE 'booking.%'
     )
     AND user_id = $1::uuid
     AND LOWER(COALESCE(
       NULLIF(payload->>'context_id', ''),
       NULLIF(payload->>'booking_id', ''),
       NULLIF(payload->>'bookingId', '')
     )) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    [canonicalId],
  );
  await pool.query(`
    WITH booking_rows AS (
      SELECT n.id, n.user_id,
        LOWER(COALESCE(
          NULLIF(n.payload->>'context_id', ''),
          NULLIF(n.payload->>'booking_id', ''),
          NULLIF(n.payload->>'bookingId', '')
        )) AS booking_ctx,
        n.read_at
      FROM notification.notifications n
      WHERE n.user_id = $1::uuid
        AND (
          COALESCE(n.payload->>'category', '') = 'booking'
          OR COALESCE(n.payload->>'notification_category', '') IN ('booking_renter', 'booking_landlord')
          OR n.event_type LIKE 'booking.%'
        )
    ),
    ctx AS (
      SELECT user_id, booking_ctx, MIN(read_at) AS context_read_at
      FROM booking_rows
      WHERE booking_ctx ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      GROUP BY user_id, booking_ctx
      HAVING BOOL_OR(read_at IS NOT NULL)
    )
    UPDATE notification.notifications n
    SET read_at = COALESCE(n.read_at, c.context_read_at)
    FROM booking_rows br
    JOIN ctx c ON br.user_id = c.user_id AND br.booking_ctx = c.booking_ctx
    WHERE n.id = br.id AND n.read_at IS NULL AND c.context_read_at IS NOT NULL
  `, [canonicalId]);
  await pool.query(`
    WITH ranked AS (
      SELECT n.id,
        ROW_NUMBER() OVER (
          PARTITION BY n.user_id,
            LOWER(COALESCE(
              NULLIF(n.payload->>'context_id', ''),
              NULLIF(n.payload->>'booking_id', ''),
              NULLIF(n.payload->>'bookingId', '')
            )),
            n.event_type, n.channel
          ORDER BY n.read_at NULLS LAST, n.created_at DESC, n.id DESC
        ) AS rn
      FROM notification.notifications n
      WHERE n.user_id = $1::uuid AND n.event_type LIKE 'booking.%'
    )
    DELETE FROM notification.notifications n
    USING ranked r
    WHERE n.id = r.id AND r.rn > 1
  `, [canonicalId]);
  return moved.rowCount ?? moved.rows.length;
}

async function applyMessagingParticipants(
  pool: pg.Pool,
  canonicalId: string,
  sourceIds: string[],
  apply: boolean,
): Promise<void> {
  if (!apply) return;
  const { rows } = await pool.query<{
    conversation_id: string;
    user_id: string;
    row_json: Record<string, unknown>;
  }>(
    `SELECT conversation_id::text, user_id::text,
            row_to_json(p.*)::jsonb AS row_json
     FROM messaging.conversation_participants p
     WHERE user_id = ANY($1::uuid[])`,
    [sourceIds],
  );
  for (const row of rows) {
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM messaging.conversation_participants
       WHERE conversation_id = $1::uuid AND user_id = $2::uuid`,
      [row.conversation_id, canonicalId],
    );
    if (existing.length) {
      await pool.query(
        `UPDATE messaging.conversation_participants c
         SET last_read_at = GREATEST(c.last_read_at, s.last_read_at),
             archived = c.archived AND s.archived,
             deleted = c.deleted AND s.deleted
         FROM messaging.conversation_participants s
         WHERE c.conversation_id = s.conversation_id
           AND c.user_id = $1::uuid
           AND s.conversation_id = $2::uuid
           AND s.user_id = $3::uuid`,
        [canonicalId, row.conversation_id, row.user_id],
      );
      await pool.query(
        `DELETE FROM messaging.conversation_participants
         WHERE conversation_id = $1::uuid AND user_id = $2::uuid`,
        [row.conversation_id, row.user_id],
      );
    } else {
      await pool.query(
        `UPDATE messaging.conversation_participants
         SET user_id = $1::uuid
         WHERE conversation_id = $2::uuid AND user_id = $3::uuid`,
        [canonicalId, row.conversation_id, row.user_id],
      );
    }
  }
  await pool.query(
    `UPDATE messaging.messages SET sender_id = $1::uuid WHERE sender_id = ANY($2::uuid[])`,
    [canonicalId, sourceIds],
  );
}

async function applyListingsAndTrust(
  pools: { listings: pg.Pool; trust: pg.Pool },
  canonicalId: string,
  sourceIds: string[],
  apply: boolean,
): Promise<void> {
  if (!apply) return;
  await pools.listings.query(
    `UPDATE listings.listings SET user_id = $1::uuid, updated_at = now()
     WHERE user_id = ANY($2::uuid[])`,
    [canonicalId, sourceIds],
  );
  for (const [table, col] of [
    ["community_posts", "author_id"],
    ["community_comments", "author_id"],
    ["community_post_votes", "user_id"],
    ["community_comment_votes", "user_id"],
  ] as const) {
    const exists = await pools.listings.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'listings' AND table_name = $1`,
      [table],
    );
    if (exists.rowCount) {
      await pools.listings.query(
        `UPDATE listings.${table} SET ${col} = $1::uuid WHERE ${col} = ANY($2::uuid[])`,
        [canonicalId, sourceIds],
      );
    }
  }
  for (const [table, col] of [
    ["reviews", "reviewer_id"],
    ["user_flags", "user_id"],
  ] as const) {
    const exists = await pools.trust.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'trust' AND table_name = $1`,
      [table],
    );
    if (exists.rowCount) {
      await pools.trust.query(
        `UPDATE trust.${table} SET ${col} = $1::uuid WHERE ${col} = ANY($2::uuid[])`,
        [canonicalId, sourceIds],
      );
    }
  }
  for (const table of ["reputation", "user_suspensions"] as const) {
    const exists = await pools.trust.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'trust' AND table_name = $1`,
      [table],
    );
    if (exists.rowCount) {
      await pools.trust.query(
        `UPDATE trust.${table} SET user_id = $1::uuid WHERE user_id = ANY($2::uuid[])`,
        [canonicalId, sourceIds],
      );
    }
  }
}

async function markAuthSourcesMerged(
  authPool: pg.Pool,
  canonicalId: string,
  sources: AuthUser[],
  apply: boolean,
): Promise<void> {
  if (!apply || !sources.length) return;
  const ids = sources.map((s) => s.id);
  await authPool.query(
    `UPDATE auth.users
     SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
           'merged_into', $1::text,
           'merged_at', to_jsonb(now())
         ),
         is_deleted = true,
         deletion_state = CASE
           WHEN deletion_state = 'active' THEN 'deleted'
           ELSE deletion_state
         END,
         updated_at = now()
     WHERE id = ANY($2::uuid[])`,
    [canonicalId, ids],
  );
}

async function purgeRedisNotificationCaches(userIds: string[]): Promise<number> {
  let Redis: typeof import("ioredis").default;
  try {
    const { createRequire } = await import("node:module");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const req = createRequire(join(here, "repair-restored-user-ownership.ts"));
    Redis = req(join(here, "../node_modules/ioredis")).default;
  } catch {
    try {
      Redis = (await import("ioredis")).default;
    } catch {
      console.warn("[repair] ioredis not available — skip Redis purge (run from repo after pnpm install)");
      return 0;
    }
  }
  const host = process.env.REDIS_HOST ?? "127.0.0.1";
  const port = Number(process.env.REDIS_PORT ?? 6380);
  const redis = new Redis({ host, port, maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
  } catch (e) {
    console.warn("[repair] Redis not reachable — skip purge", e);
    return 0;
  }
  const keys = new Set<string>();
  for (const raw of userIds) {
    const uid = raw.trim().toLowerCase();
    const idx = `cache-index:user:${uid}`;
    const indexed = await redis.smembers(idx);
    for (const k of indexed) keys.add(k);
    let cursor = "0";
    do {
      const [next, found] = await redis.scan(cursor, "MATCH", `notifications:user:${uid}:*`, "COUNT", 100);
      cursor = next;
      for (const k of found) keys.add(k);
    } while (cursor !== "0");
    keys.add(idx);
  }
  if (!keys.size) {
    await redis.quit();
    return 0;
  }
  const pipe = redis.pipeline();
  for (const k of Array.from(keys)) pipe.del(k);
  await pipe.exec();
  await redis.quit();
  return keys.size;
}

function printReport(plan: RepairPlan, apply: boolean): void {
  console.log("\n=== Account consolidation repair ===\n");
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Run id: ${plan.runId}`);
  console.log(`\nCanonical: ${plan.canonical.id}`);
  console.log(`  email:    ${plan.canonical.email}`);
  console.log(`  username: ${plan.canonical.username}`);
  console.log(`\nSource accounts (${plan.sources.length}):`);
  for (const s of plan.sources) {
    console.log(`  ${s.id}  ${s.email || "(no email)"}  ${s.username || "(no username)"}`);
  }
  if (plan.excluded.length) {
    console.log(`\nExcluded (${plan.excluded.length}) — not merged unless --include-user-id:`);
    for (const e of plan.excluded) {
      console.log(`  ${e.user.id}  ${e.user.email}  ${e.user.username}  → ${e.reason}`);
    }
  }
  console.log("\nPlanned row updates:");
  let total = 0;
  for (const c of plan.changes) {
    if (c.rowCount === 0) continue;
    total += c.rowCount;
    console.log(
      `  ${c.database}.${c.schema}.${c.table}.${c.column}: ${c.rowCount}` +
        (c.sampleIds.length ? `  e.g. ${c.sampleIds.slice(0, 3).join(", ")}` : ""),
    );
  }
  console.log(`\nTotal rows touched (estimate): ${total}`);
  for (const w of plan.warnings) console.log(`  ⚠ ${w}`);
}

async function printBookingAcceptance(
  bookingsPool: pg.Pool,
  canonicalId: string,
  sourceIds: string[],
  matchUsername: string,
): Promise<void> {
  const base = cleanUsernameBase(matchUsername);
  const ids = [canonicalId, ...sourceIds];
  const { rows } = await bookingsPool.query(
    `SELECT tenant_id::text, tenant_username_snapshot, COUNT(*)::int AS n
     FROM booking.bookings
     WHERE tenant_id = ANY($1::uuid[])
        OR tenant_username_snapshot ILIKE $2
     GROUP BY tenant_id, tenant_username_snapshot
     ORDER BY n DESC`,
    [ids, `%${base}%`],
  );
  console.log("\nAcceptance B) bookings by tenant:");
  for (const r of rows) {
    console.log(`  ${r.tenant_id}  @${r.tenant_username_snapshot ?? ""}  count=${r.n}`);
  }
  const mustHave = ["fee5c010-a9de-424f-a587-02821273310f", "a7d04d20-edec-43bc-a6dd-1fc9e71b48a4"];
  for (const bid of mustHave) {
    const { rows: b } = await bookingsPool.query(
      `SELECT id::text, tenant_id::text, status FROM booking.bookings WHERE id = $1::uuid`,
      [bid],
    );
    const row = b[0];
    if (!row) console.log(`  ✗ missing booking ${bid}`);
    else if (row.tenant_id === canonicalId) console.log(`  ✓ ${bid} tenant=${canonicalId} status=${row.status}`);
    else console.log(`  ✗ ${bid} tenant=${row.tenant_id} (expected ${canonicalId})`);
  }
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  const pools = {
    auth: new pg.Pool({ connectionString: URLS.auth }),
    bookings: new pg.Pool({ connectionString: URLS.bookings }),
    listings: new pg.Pool({ connectionString: URLS.listings }),
    notification: new pg.Pool({ connectionString: URLS.notification }),
    messaging: new pg.Pool({ connectionString: URLS.messaging }),
    trust: new pg.Pool({ connectionString: URLS.trust }),
  };

  try {
    const canonical = await loadAuthUser(pools.auth, cli.canonicalUserId);
    if (!canonical) {
      console.error(`Canonical user not found: ${cli.canonicalUserId}`);
      process.exit(1);
    }
    if (cli.canonicalEmail && canonical.email.toLowerCase() !== cli.canonicalEmail) {
      console.warn(
        `Warning: canonical email mismatch DB=${canonical.email} cli=${cli.canonicalEmail}`,
      );
    }

    const candidates = await discoverAuthCandidates(pools.auth, cli.matchUsername);
    const bookingTenantIds = await discoverBookingTenantUserIds(pools.bookings, cli.matchUsername);
    const { sources, excluded } = await resolveSources(
      pools.auth,
      canonical,
      candidates,
      bookingTenantIds,
      cli,
    );

    const uniqSources = Array.from(new Map(sources.map((s) => [s.id.toLowerCase(), s])).values()).filter(
      (s) => s.id.toLowerCase() !== canonical.id.toLowerCase(),
    );
    const sourceIds = uniqSources.map((s) => s.id.toLowerCase());

    console.log("\n=== Matched auth users (acceptance A) ===");
    const explicitLoaded: AuthUser[] = [];
    for (const id of cli.includeUserIds) {
      if (id === cli.canonicalUserId) continue;
      const u = await loadAuthUser(pools.auth, id);
      if (u) explicitLoaded.push(u);
    }
    const { rows: acceptanceA } = await pools.auth.query(
      `SELECT id::text, email::text, username::text, display_username::text AS display_name
       FROM auth.users
       WHERE lower(email) LIKE '%' || $1 || '%'
          OR lower(username::text) LIKE '%' || $1 || '%'
          OR lower(COALESCE(display_username::text, '')) LIKE '%' || $1 || '%'
       ORDER BY created_at`,
      [cleanUsernameBase(cli.matchUsername)],
    );
    const reportUsers = Array.from(
      new Map([...acceptanceA, ...explicitLoaded].map((u) => [u.id, u])).values(),
    );
    for (const u of reportUsers) {
      const tag =
        u.id === canonical.id
          ? "canonical"
          : uniqSources.some((s) => s.id === u.id)
            ? "MERGE"
            : explicitLoaded.some((e) => e.id === u.id)
              ? "MERGE (explicit)"
              : "skip";
      console.log(`  [${tag}] ${u.id}  ${u.email}  ${u.username}`);
    }

    const plan = await buildPlan(pools, cli, canonical, uniqSources, excluded);
    printReport(plan, cli.apply);

    if (cli.dryRunJson) {
      writeFileSync(cli.dryRunJson, JSON.stringify(plan, null, 2));
      console.log(`\nWrote dry-run JSON: ${cli.dryRunJson}`);
    }

    await printBookingAcceptance(
      pools.bookings,
      canonical.id,
      sourceIds,
      cli.matchUsername,
    );

    if (!cli.apply) {
      console.log("\nDry run only — re-run with --apply to persist changes.");
      console.log("Snapshots (rollback) are written to auth.repair.consolidation_row_snapshots on apply.");
      return;
    }

    await ensureSnapshotSchema(pools.auth);
    const canonicalUsername =
      canonical.username || canonical.display_username || cleanUsernameBase(cli.matchUsername);

    await applyBookings(
      pools.bookings,
      pools.auth,
      plan,
      canonical.id,
      sourceIds,
      canonicalUsername,
      true,
    );
    await applyListingsAndTrust(
      { listings: pools.listings, trust: pools.trust },
      canonical.id,
      sourceIds,
      true,
    );
    const notifMoved = await applyNotifications(pools.notification, canonical.id, sourceIds, true);
    await applyMessagingParticipants(pools.messaging, canonical.id, sourceIds, true);
    await markAuthSourcesMerged(pools.auth, canonical.id, uniqSources, true);

    const purgeIds = [canonical.id, ...sourceIds];
    let purged = 0;
    if (!cli.skipRedis) {
      purged = await purgeRedisNotificationCaches(purgeIds);
    }
    console.log(`\nApplied. Notifications repointed: ${notifMoved}. Redis keys purged: ${purged}.`);
    console.log(`Rollback snapshots run_id=${plan.runId} in auth.repair.consolidation_row_snapshots`);

    await printBookingAcceptance(pools.bookings, canonical.id, [], cli.matchUsername);
  } finally {
    await Promise.all(Object.values(pools).map((p) => p.end()));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
