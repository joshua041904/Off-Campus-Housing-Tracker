# --- deps ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common ./services/common
COPY services/booking-service ./services/booking-service
COPY proto ./proto

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm -w --filter @common/utils... --filter booking-service... install --no-frozen-lockfile --ignore-scripts

# --- build ---
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=deps /app /app

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/common build

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/booking-service build

# --- runtime ---
FROM node:20-bookworm-slim
WORKDIR /app/services/booking-service

ENV NODE_ENV=production

COPY scripts/docker/debian-apt-update.sh \
  scripts/docker/install-grpc-health-probe.sh \
  scripts/docker/install-bookworm-runtime-probe.sh \
  /tmp/
# grpc-health-probe for strict TLS/mTLS gRPC probes
ARG GRPC_HEALTH_PROBE_VERSION=v0.4.24
RUN chmod +x /tmp/debian-apt-update.sh /tmp/install-grpc-health-probe.sh /tmp/install-bookworm-runtime-probe.sh && \
  GRPC_HEALTH_PROBE_VERSION="${GRPC_HEALTH_PROBE_VERSION}" /tmp/install-bookworm-runtime-probe.sh

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/booking-service/node_modules ./node_modules
COPY --from=build /app/services/booking-service/dist ./dist
COPY --from=build /app/services/booking-service/prisma ./prisma
COPY --from=build /app/services/booking-service/package.json ./package.json
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto /app/proto

EXPOSE 4013 50063
CMD ["node", "dist/server.js"]
