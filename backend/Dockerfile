# Multi-stage: install build deps separately so the runtime image only
# carries production node_modules. Keeps the image small and excludes
# Jest/supertest/nodemon from the deployed artifact.

# ── Stage 1: install all deps and copy source ───────────────────────────────
FROM node:18-alpine AS deps
WORKDIR /app

# dumb-init is PID-1 so SIGTERM from `docker stop` / Kubernetes / Compose is
# forwarded to node instead of being swallowed by npm.
RUN apk add --no-cache dumb-init

COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:18-alpine AS runtime
WORKDIR /app

# wget is used by the docker healthcheck below. postgresql15-client provides
# pg_dump for the nightly backup cron (utils/backup.js) — matched to the
# db service's own major version (postgres:15-alpine) so the dump format is
# never a version mismatch away from failing to restore.
RUN apk add --no-cache dumb-init wget postgresql15-client

# Run as an unprivileged user. The `node` user (uid 1000) ships with the
# official node:alpine image. /app/uploads must be writable by it.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

RUN mkdir -p /app/uploads && chown -R node:node /app/uploads \
 && chmod +x /app/docker-entrypoint.sh

USER node

ENV NODE_ENV=production
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

# dumb-init forwards signals; the entrypoint script runs migrations then
# execs node, so SIGTERM still reaches node's event loop and cron jobs can
# shut down cleanly.
ENTRYPOINT ["dumb-init", "--", "/app/docker-entrypoint.sh"]
