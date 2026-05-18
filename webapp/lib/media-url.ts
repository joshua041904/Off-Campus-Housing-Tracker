export function normalizeMediaUrl(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "/placeholder.svg";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return s;
  const base = String(process.env.NEXT_PUBLIC_API_BASE ?? "").trim().replace(/\/$/, "");
  if (base) return `${base}/${s.replace(/^\/+/, "")}`;
  return `/${s.replace(/^\/+/, "")}`;
}

/** Community (and similar) post images: same-origin `/api/media/...` or absolute presigned URLs. */
export function resolveCommunityImageUrl(raw: string | null | undefined): string {
  return normalizeMediaUrl(raw);
}
