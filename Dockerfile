FROM node:24 AS builder
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

# Build-time values only. Runtime secrets come from Compose env_file.
ENV SKIP_ENV_VALIDATION=1
ENV DATABASE_URL=file:/data/build.db
ENV CORS_ORIGIN=http://localhost:3300
ENV PORT=3300
ENV VITE_SERVER_URL=http://localhost:3300

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --linker hoisted
RUN bun run --filter server build
RUN bun run --filter web build
RUN mkdir -p public && cp -R apps/web/dist/. public/

FROM builder AS runner
ENV NODE_ENV=production
ENV PORT=3300
ENV WEB_DIST_DIR=/app/public

EXPOSE 3300
CMD ["bun", "run", "apps/server/dist/index.mjs"]
