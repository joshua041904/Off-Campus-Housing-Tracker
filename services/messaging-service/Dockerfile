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

COPY scripts/docker/debian-apt-update.sh \
  scripts/docker/install-grpc-health-probe.sh \
  scripts/docker/install-bookworm-runtime-probe.sh \
  /tmp/
# grpc-health-probe for strict TLS/mTLS health checks (K8s exec probes)
ARG GRPC_HEALTH_PROBE_VERSION=v0.4.24
RUN chmod +x /tmp/debian-apt-update.sh /tmp/install-grpc-health-probe.sh /tmp/install-bookworm-runtime-probe.sh && \
  GRPC_HEALTH_PROBE_VERSION="${GRPC_HEALTH_PROBE_VERSION}" /tmp/install-bookworm-runtime-probe.sh openssl

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/messaging-service/node_modules ./node_modules
COPY --from=build /app/services/messaging-service/dist ./dist
COPY --from=build /app/services/messaging-service/src/lib/singleflight_cache.lua ./dist/lib/singleflight_cache.lua
COPY --from=build /app/services/messaging-service/package.json ./package.json
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto /app/proto

EXPOSE 4014 50064
CMD ["node", "dist/server.js"]
