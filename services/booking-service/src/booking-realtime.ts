import { createClient, type RedisClientType } from "redis";

const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
let redisClient: RedisClientType | null = null;
let connectAttempted = false;

async function redis(): Promise<RedisClientType | null> {
  if (redisClient?.isOpen) return redisClient;
  if (connectAttempted) return null;
  connectAttempted = true;
  try {
    redisClient = createClient({ url: redisUrl, socket: { connectTimeout: 800 } });
    redisClient.on("error", () => {});
    await redisClient.connect();
    return redisClient;
  } catch {
    return null;
  }
}

export async function acquireListingSoftLock(listingId: string, renterId: string, ttlSec = 300): Promise<boolean> {
  const r = await redis();
  if (!r?.isOpen) return true;
  const key = `listing:${listingId}:lock`;
  const out = await r.set(key, renterId, { EX: ttlSec, NX: true });
  return out === "OK";
}

export async function releaseListingSoftLock(listingId: string): Promise<void> {
  const r = await redis();
  if (!r?.isOpen) return;
  await r.del(`listing:${listingId}:lock`);
}

export async function incrementListingBookingCount(listingId: string): Promise<number | null> {
  const r = await redis();
  if (!r?.isOpen) return null;
  const key = `listing:${listingId}:booking_count`;
  const n = await r.incr(key);
  await r.expire(key, 60 * 60 * 24);
  return n;
}

export async function decrementListingBookingCount(listingId: string): Promise<number | null> {
  const r = await redis();
  if (!r?.isOpen) return null;
  const key = `listing:${listingId}:booking_count`;
  const n = await r.decr(key);
  if (n < 0) {
    await r.set(key, "0", { EX: 60 * 60 * 24 });
    return 0;
  }
  return n;
}

export async function computeFraudScore(input: {
  bookingId: string;
  listingId: string;
  renterId: string;
  priceCents: number;
  requestIp: string;
  recentBookingCount10m: number;
  recentBookingCount5m: number;
  renterAccountAgeHours: number;
}): Promise<{ score: number; flagged: boolean; factors: string[] }> {
  const factors: string[] = [];
  let score = 0;
  if (input.recentBookingCount10m > 5) {
    score += 30;
    factors.push("velocity_10m_gt_5");
  }
  if (input.recentBookingCount5m > 8) {
    score += 20;
    factors.push("velocity_5m_gt_8");
  }
  if (input.renterAccountAgeHours < 24) {
    score += 15;
    factors.push("renter_account_age_lt_24h");
  }
  const areaMedian = Number(process.env.BOOKING_AREA_MEDIAN_PRICE_CENTS || "120000");
  if (Number.isFinite(areaMedian) && areaMedian > 0 && input.priceCents > areaMedian * 2) {
    score += 25;
    factors.push("price_vs_area_median_gt_2x");
  }
  const r = await redis();
  if (r?.isOpen && input.requestIp) {
    const key = `fraud:ip:${input.requestIp}`;
    await r.sAdd(key, input.renterId);
    await r.expire(key, 600);
    const count = await r.sCard(key);
    if (count > 1) {
      score += 20;
      factors.push("same_ip_multiple_renters");
    }
    await r.set(`booking:${input.bookingId}:fraud_score`, String(score), { EX: 60 * 60 * 24 });
  }
  return { score, flagged: score >= 60, factors };
}

/** JSON payload for `bookings.fraud_signals` (array of factor codes). */
export function fraudFactorsToSignals(factors: string[]): unknown {
  return factors;
}

const tenantBookingBanKey = (tenantId: string) => `booking:tenant:${tenantId}:booking_banned`;

/** Bounded Redis retention for fraud bans (avoids immortal keys). Default 10y; override with BOOKING_TENANT_BAN_TTL_SEC. */
const tenantBanTtlSec = (): number => {
  const raw = Number(process.env.BOOKING_TENANT_BAN_TTL_SEC ?? 86400 * 365 * 10);
  if (!Number.isFinite(raw) || raw <= 0) return 86400 * 365 * 10;
  return Math.min(Math.floor(raw), 2_147_483_647);
};

export async function isTenantBookingBanned(tenantId: string): Promise<boolean> {
  const r = await redis();
  if (!r?.isOpen) return false;
  return (await r.get(tenantBookingBanKey(tenantId))) === "1";
}

export async function persistTenantBookingBan(tenantId: string): Promise<void> {
  const r = await redis();
  if (!r?.isOpen) return;
  await r.set(tenantBookingBanKey(tenantId), "1", { EX: tenantBanTtlSec() });
}
