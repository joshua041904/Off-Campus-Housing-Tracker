# Build from repo root: docker build -f services/trust-service/Dockerfile -t trust-service:dev .
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common ./services/common
COPY services/trust-service ./services/trust-service
COPY proto ./proto
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -w --filter @common/utils... --filter trust-service... install --no-frozen-lockfile --ignore-scripts

FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY --from=deps /app /app
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/common build
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/trust-service build

FROM node:20-bookworm-slim
WORKDIR /app/services/trust-service
ENV NODE_ENV=production
ARG GRPC_HEALTH_PROBE_VERSION=v0.4.24
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
  ARCH=$(dpkg --print-architecture) && \
  case "$ARCH" in amd64) BINARY_ARCH=amd64 ;; arm64) BINARY_ARCH=arm64 ;; *) BINARY_ARCH=amd64 ;; esac && \
  curl -Lf -o /usr/local/bin/grpc-health-probe \
    "https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-${BINARY_ARCH}" && \
  chmod +x /usr/local/bin/grpc-health-probe && \
  apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/trust-service/node_modules ./node_modules
COPY --from=build /app/services/trust-service/dist ./dist
COPY --from=build /app/services/trust-service/package.json ./package.json
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto /app/proto
EXPOSE 4016 50066
CMD ["node", "dist/server.js"]
