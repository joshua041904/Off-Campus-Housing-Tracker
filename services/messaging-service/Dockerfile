# --- deps ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common ./services/common
COPY services/messaging-service ./services/messaging-service
COPY proto ./proto

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm -w --filter @common/utils... --filter messaging-service... install --no-frozen-lockfile --ignore-scripts

# --- build ---
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=deps /app /app

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/common build

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/messaging-service build

# --- runtime ---
FROM node:20-bookworm-slim
WORKDIR /app/services/messaging-service

ENV NODE_ENV=production

# grpc-health-probe for strict TLS/mTLS health checks (K8s exec probes)
ARG GRPC_HEALTH_PROBE_VERSION=v0.4.24
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates openssl && \
  ARCH=$(dpkg --print-architecture) && \
  case "$ARCH" in amd64) BINARY_ARCH=amd64 ;; arm64) BINARY_ARCH=arm64 ;; *) BINARY_ARCH=amd64 ;; esac && \
  curl -Lf -o /usr/local/bin/grpc-health-probe \
    "https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-${BINARY_ARCH}" && \
  chmod +x /usr/local/bin/grpc-health-probe && \
  apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/messaging-service/node_modules ./node_modules
COPY --from=build /app/services/messaging-service/dist ./dist
COPY --from=build /app/services/messaging-service/src/lib/singleflight_cache.lua ./dist/lib/singleflight_cache.lua
COPY --from=build /app/services/messaging-service/package.json ./package.json
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto /app/proto

EXPOSE 4014 50064
CMD ["node", "dist/server.js"]
