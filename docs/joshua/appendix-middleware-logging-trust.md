# Appendix — Middleware, logging & interceptors (trust / gateway)

**Owner:** Joshua (reference from [`Github_issues copy.txt`](../../Github_issues%20copy.txt)) · **Hub:** [`JOSHUA_ISSUES_PLAYBOOK.md`](../JOSHUA_ISSUES_PLAYBOOK.md)

## Summary

There is **no** single shared Express middleware package that every service imports. Patterns differ by layer.

## Gateway (most HTTP middleware)

| Topic | Location |
|--------|----------|
| Helmet, CORS, compression, rate limits | [`services/api-gateway/src/server.ts`](../../services/api-gateway/src/server.ts) |
| Query sanitization, Prometheus route counter | Same file — `res.on("finish", ...)` |
| JWT / identity | Gateway auth path before proxies |
| Proxy to listings, trust, etc. | `http-proxy-middleware`; trust: `/trust`, `/api/trust` |
| Final error handler | `app.use((err, req, res, next) => ...)` |

Trust traffic hits gateway **after** this stack.

## Trust HTTP (minimal middleware)

| Topic | Location |
|--------|----------|
| `express.json`, per-route handlers | [`services/trust-service/src/http-server.ts`](../../services/trust-service/src/http-server.ts) |
| `httpCounter` on finish | Small middleware in same file |
| `requireUser` | Checks `x-user-id` header |
| Errors | Mostly `console.error` + JSON body — **not** using shared Pino in trust HTTP today |

## Trust gRPC

| Topic | Location |
|--------|----------|
| Handlers | [`services/trust-service/src/grpc-server.ts`](../../services/trust-service/src/grpc-server.ts) |
| Logging | Ad hoc `console.error` in `.catch()` — **no** `withLogging` wrapper like some other services |

## Shared utilities (available but not fully adopted by trust HTTP)

| Module | Path |
|--------|------|
| Pino logger | [`services/common/src/logger.ts`](../../services/common/src/logger.ts) |
| OpenTelemetry | [`services/common/src/tracing.ts`](../../services/common/src/tracing.ts) — trust `server.ts` may not call `initTracing()`; verify when adding tracing |

## Practical guidance for tickets

- **Structured logs / request IDs:** natural touch points are **trust** `http-server.ts` / `grpc-server.ts`, or rely on **gateway + Caddy** JSON logs for correlation.
- **Normalize errors:** implement helpers **inside** trust HTTP (and mirror in gRPC) rather than waiting for a new common package.
- Optional future: thin `httpRequestLogger` in `services/common` — **not** required to close Issues 10–12.

## Flag / report-abuse code map

| Area | Files / notes |
|------|----------------|
| HTTP report abuse | [`services/trust-service/src/http-server.ts`](../../services/trust-service/src/http-server.ts) — `POST /report-abuse` |
| gRPC | [`services/trust-service/src/grpc-server.ts`](../../services/trust-service/src/grpc-server.ts) — `ReportAbuse`, `FlagListing` |
| Schema | [`infra/db/01-trust-schema.sql`](../../infra/db/01-trust-schema.sql) — `listing_flags`, `user_flags` |
| Peer review duplicate pattern | Same `http-server.ts` — maps **23505** / `"unique"` → **409** `{ "error": "duplicate review" }` — **copy pattern for flags** if using UNIQUE constraint |
| Invalid UUID | Validate before query to avoid **500** from Postgres |
| Webapp | [`webapp/app/trust/page.tsx`](../../webapp/app/trust/page.tsx), [`webapp/lib/api.ts`](../../webapp/lib/api.ts) `reportAbuse` |

## Rebuild reminder

Trust-only: `pnpm run rebuild:service:trust`.
