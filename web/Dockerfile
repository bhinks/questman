# =====================================================================
# Questman frontend — production image
#
# Multi-stage:
#   1. node-alpine: install deps + `vite build` → static bundle in dist/
#   2. nginx-alpine: serve dist/ + proxy /api and /socket.io to backend
# =====================================================================

# ----- 1) Build -------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
# npm install (not ci) because optional native deps in the lockfile
# differ across host platforms (host: WSL, image: linux); ci is strict
# about lock parity, install tolerates it.
RUN npm install --no-audit --no-fund

COPY . .

# Sub-path mount: the edge can serve this under a path prefix (e.g. /questman/),
# so the Vite asset base must match. Passed from the compose override; '/' default.
ARG VITE_BASE=/
ENV VITE_BASE=$VITE_BASE
# VITE_API_URL is "" in production so the frontend talks to the same
# origin nginx is fronting — the proxy below handles /api + /socket.io.
ENV VITE_API_URL=""
RUN npm run build

# ----- 2) Serve -------------------------------------------------------
FROM nginx:alpine

# nginx config: serve SPA + proxy /api + /socket.io
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static bundle
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
