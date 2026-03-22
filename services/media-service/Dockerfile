# --- deps ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY .npmrc ./
COPY services/common ./services/common
COPY services/media-service ./services/media-service

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    --mount=type=cache,id=pnpm-cache,target=/root/.cache/pnpm \
    pnpm -w --filter @common/utils... --filter media-service... install --frozen-lockfile --ignore-scripts

# --- build ---
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate

COPY --from=deps /app /app

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/common build

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm -C services/media-service build

# --- runtime ---
FROM node:20-bookworm-slim
WORKDIR /app/services/media-service

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
COPY --from=build /app/services/media-service/node_modules ./node_modules
COPY --from=build /app/services/media-service/dist ./dist
COPY --from=build /app/services/media-service/package.json ./package.json
COPY --from=build /app/services/common /app/services/common

EXPOSE 4018 50068
CMD ["node", "dist/server.js"]
