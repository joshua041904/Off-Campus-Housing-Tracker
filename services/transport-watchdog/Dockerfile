# Build from repo root: docker build -t transport-watchdog:dev -f services/transport-watchdog/Dockerfile .
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY services/transport-watchdog/package.json services/transport-watchdog/tsconfig.json ./
COPY services/transport-watchdog/src ./src
RUN npm install && npm run build

FROM node:20-bookworm-slim
WORKDIR /app
COPY services/transport-watchdog/package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/index.js"]
