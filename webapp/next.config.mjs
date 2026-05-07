/** Default in dev: proxy /api/* to api-gateway (avoids CORS). Set NEXT_PUBLIC_API_BASE to hit the edge URL from the browser instead. */
const gatewayInternal = process.env.API_GATEWAY_INTERNAL || "http://127.0.0.1:4020";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    if (process.env.NEXT_PUBLIC_API_BASE) return [];
    // /api/* → gateway; /insights/* → same gateway (analytics service-relative paths). Without this,
    // GET /insights/listing-feel hits Next and yields "Cannot GET" — nginx had the same gap before location ^~ /insights/.
    return [
      { source: "/api/:path*", destination: `${gatewayInternal}/api/:path*` },
      { source: "/insights/:path*", destination: `${gatewayInternal}/insights/:path*` },
    ];
  },
};

export default nextConfig;
