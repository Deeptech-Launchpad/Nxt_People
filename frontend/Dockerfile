# ── Stage 1: build the Vite bundle ──────────────────────────────────────────
FROM node:18-alpine AS build
WORKDIR /app

# Install deps using lockfile only — faster, reproducible
COPY package*.json ./
RUN npm ci

# Copy source and produce /app/dist
COPY . .

# Vite inlines VITE_* values at BUILD time. The local .env is excluded by
# .dockerignore, so without this the production bundle would have no Google
# Client ID and the "Sign in with Google" button would hide itself (works in
# `npm run dev` locally, but not in the built image — exactly the prod bug).
# These are PUBLIC values (the OAuth Client ID ships in the browser bundle
# regardless), so we bake working defaults here and allow overrides via
# docker build-args / docker-compose `build.args`.
ARG VITE_GOOGLE_CLIENT_ID=981002835126-5cnvmt801mv858v2cvsuith9n1g5nsdh.apps.googleusercontent.com
ARG VITE_GOOGLE_HOSTED_DOMAIN=altiusnxt.com
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_HOSTED_DOMAIN=$VITE_GOOGLE_HOSTED_DOMAIN

RUN npm run build

# ── Stage 2: serve the static bundle with nginx ─────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Proper config file (kept in repo as frontend/nginx.conf). Replaces the
# default server block so we own the listen port + locations end-to-end.
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

# nginx:alpine ships without curl; busybox provides wget.
#
# 127.0.0.1, not localhost. nginx binds IPv4 (`listen 80;`), and in a container
# where localhost also resolves to ::1 the probe can hit the v6 address and be
# refused — which is how this reported ten consecutive failures while nginx was
# serving the site perfectly.
#
# stderr is deliberately NOT redirected away. It was, so the failure recorded
# exit code 1 with completely empty output and `docker inspect` could not say
# what had gone wrong. A healthcheck that cannot explain itself is barely
# better than no healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
