# ── Stage 1: build the Vite bundle ──────────────────────────────────────────
FROM node:18-alpine AS build
WORKDIR /app

# Install deps using lockfile only — faster, reproducible
COPY package*.json ./
RUN npm ci

# Copy source and produce /app/dist
COPY . .
RUN npm run build

# ── Stage 2: serve the static bundle with nginx ─────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Proper config file (kept in repo as frontend/nginx.conf). Replaces the
# default server block so we own the listen port + locations end-to-end.
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

# nginx:alpine ships with a curl-less image; the healthcheck uses wget which
# is included in busybox.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
