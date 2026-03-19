# --- deps ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Copy full workspace source for common + auth-service + proto so pnpm install sees real tree
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common ./services/common
COPY services/auth-service ./services/auth-service
COPY proto ./proto

# Install with workspace intact so @common/utils symlinks point at services/common
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm -w --filter @common/utils... --filter auth-service... install --frozen-lockfile --ignore-scripts

# --- build ---
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

# Use deps stage as-is: do not COPY services/* again or symlinks break
COPY --from=deps /app /app

# Build common first so @common/utils dist/ exists before any service tsc runs (CI-safe)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/common build

# Let workspace orchestrate build (topological order)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -w build

# --- runtime ---
FROM node:20-bookworm-slim
WORKDIR /app/services/auth-service

# grpc-health-probe for strict TLS/mTLS health checks (K8s exec probes)
ARG GRPC_HEALTH_PROBE_VERSION=v0.4.24
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
  ARCH=$(dpkg --print-architecture) && \
  case "$ARCH" in amd64) BINARY_ARCH=amd64 ;; arm64) BINARY_ARCH=arm64 ;; *) BINARY_ARCH=amd64 ;; esac && \
  curl -Lf -o /usr/local/bin/grpc-health-probe \
    "https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-${BINARY_ARCH}" && \
  chmod +x /usr/local/bin/grpc-health-probe && \
  apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/auth-service/node_modules ./node_modules
COPY --from=build /app/services/auth-service/dist ./dist
COPY --from=build /app/services/auth-service/package.json ./package.json
# prisma dir includes generated client at ./prisma/generated/client
COPY --from=build /app/services/auth-service/prisma ./prisma
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto /app/proto

EXPOSE 4001
CMD ["node", "dist/server.js"]