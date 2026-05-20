# Build from repo root: docker build -f services/listings-service/Dockerfile -t listings-service:dev .
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common ./services/common
COPY services/listings-service ./services/listings-service
COPY proto ./proto
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -w --filter @common/utils... --filter listings-service... install --no-frozen-lockfile --ignore-scripts

FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY --from=deps /app /app
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/common build
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/listings-service build

FROM node:20-bookworm-slim
WORKDIR /app/services/listings-service
ENV NODE_ENV=production
COPY scripts/docker/debian-apt-update.sh \
  scripts/docker/install-grpc-health-probe.sh \
  scripts/docker/install-bookworm-runtime-probe.sh \
  /tmp/
ARG GRPC_HEALTH_PROBE_VERSION=v0.4.24
RUN chmod +x /tmp/debian-apt-update.sh /tmp/install-grpc-health-probe.sh /tmp/install-bookworm-runtime-probe.sh && \
  GRPC_HEALTH_PROBE_VERSION="${GRPC_HEALTH_PROBE_VERSION}" /tmp/install-bookworm-runtime-probe.sh
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/listings-service/node_modules ./node_modules
COPY --from=build /app/services/listings-service/dist ./dist
COPY --from=build /app/services/listings-service/package.json ./package.json
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto /app/proto
EXPOSE 4012 50062
CMD ["node", "dist/server.js"]
