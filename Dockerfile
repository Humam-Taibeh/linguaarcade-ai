# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — Build
# Uses the full Node toolchain to type-check and bundle the app. Nothing from
# this stage ships to production except the static files in /app/dist.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Copy the dependency manifest first so Docker layer-caches `npm ci` — code
# changes then rebuild in seconds instead of re-downloading node_modules.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — Serve
# A ~10 MB nginx image serving pre-built static assets. There is deliberately
# no Node runtime in production: this app is a fully static SPA.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS serve

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget --quiet --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
