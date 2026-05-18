/**
 * Re-sign inline community images on read so stored URLs never expire in the UI.
 * Must match media-service `signInlineMediaDownload` (same secret + HMAC message format).
 */
import { createHmac } from "node:crypto";

const UUID_IN_PUBLIC_PATH =
  /\/api\/media\/public\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

function mediaPublicSecret(): string {
  return String(process.env.MEDIA_PUBLIC_URL_SECRET || process.env.JWT_SECRET || "och-media-public-dev").trim();
}

export function signInlineMediaDownload(mediaId: string, expSec: number): string {
  const msg = `${mediaId}:${expSec}`;
  return createHmac("sha256", mediaPublicSecret()).update(msg).digest("hex");
}

const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60;

export function buildFreshPublicMediaUrl(mediaId: string): string {
  const ttl = Number(process.env.OCH_COMMUNITY_MEDIA_URL_TTL_SEC || DEFAULT_TTL_SEC);
  const safeTtl = Number.isFinite(ttl) ? Math.min(Math.max(3600, ttl), 30 * 24 * 3600) : DEFAULT_TTL_SEC;
  const exp = Math.floor(Date.now() / 1000) + safeTtl;
  const sig = signInlineMediaDownload(mediaId, exp);
  return `/api/media/public/${encodeURIComponent(mediaId)}?e=${exp}&s=${encodeURIComponent(sig)}`;
}

/** If URL targets our public inline media path, replace query with a fresh signature. */
export function refreshCommunityImageUrlIfPublicInline(storedUrl: string): string {
  const s = String(storedUrl || "").trim();
  if (!s) return s;
  const m = s.match(UUID_IN_PUBLIC_PATH);
  if (!m?.[1]) return s;
  return buildFreshPublicMediaUrl(m[1]);
}

export function mapCommunityImagesJson(images: unknown): Array<{ url: string; alt: string | null }> {
  if (!Array.isArray(images)) return [];
  const out: Array<{ url: string; alt: string | null }> = [];
  for (const raw of images) {
    const o = raw as { url?: unknown; alt?: unknown };
    const u = String(o?.url ?? "").trim();
    if (!u) continue;
    const alt = o?.alt != null && String(o.alt).trim() ? String(o.alt).trim() : null;
    out.push({ url: refreshCommunityImageUrlIfPublicInline(u), alt });
  }
  return out;
}
