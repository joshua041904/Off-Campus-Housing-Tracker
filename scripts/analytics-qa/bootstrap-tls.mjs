/**
 * Lab / MetalLB + Caddy (TLS / H2 / H3) with a private CA or self-signed cert:
 *   ANALYTICS_QA_TLS_INSECURE=1  → sets NODE_TLS_REJECT_UNAUTHORIZED=0 (same idea as curl -k).
 *
 * Prefer `BASE_URL=https://off-campus-housing.test` (hosts → MetalLB IP) so SNI/Host matches Caddy;
 * hitting bare IP can yield HTTP 421 if the site block expects a hostname.
 */
if (process.env.ANALYTICS_QA_TLS_INSECURE === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}
