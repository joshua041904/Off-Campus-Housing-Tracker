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
    pnpm -w --filter @common/utils... --filter messaging-service... install --frozen-lockfile --ignore-scripts

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

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/services/messaging-service/node_modules ./node_modules
COPY --from=build /app/services/messaging-service/dist ./dist
COPY --from=build /app/services/messaging-service/package.json ./package.json
COPY --from=build /app/services/common /app/services/common
COPY --from=build /app/proto /app/proto

EXPOSE 50064
CMD ["node", "dist/server.js"]
