# Build from repository root:
#   docker build -f webapp/Dockerfile -t och-webapp .
FROM node:20-bookworm-slim
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter webapp build
EXPOSE 3000
CMD ["pnpm", "--filter", "webapp", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
