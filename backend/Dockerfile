# =====================================================================
# Questman backend — production image
#
# Personal-scale hub: we run via tsx (TypeScript loader) rather than
# compiled tsc output. Reason: the upstream codebase (originally
# FinDash) has pre-existing tsc errors in some legacy services we
# don't touch here. Fixing them is on the follow-up list, but they
# don't affect runtime behavior — tsx strips types without
# type-checking, same as dev mode.
# =====================================================================
FROM node:22-alpine

WORKDIR /app

# Install deps. npm ci is reproducible from package-lock.json.
COPY package.json package-lock.json ./
# npm install (not ci): host lockfile may diverge on optional native
# deps (host: WSL, image: linux). install tolerates the drift.
RUN npm install --no-audit --no-fund

# Persistent data volume — the SQLite file + migration journal live
# here so they survive container rebuilds. Set DATABASE_URL ahead of
# `prisma generate` so the CLI sees a valid value during build.
RUN mkdir -p /data
ENV DATABASE_URL="file:/data/questman.db"
ENV NODE_ENV=production
ENV PORT=3001

# Copy source + prisma schema + entrypoint.
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./
COPY docker-entrypoint.sh ./

# Generate the Prisma client now so first boot doesn't have to.
RUN npx prisma generate

EXPOSE 3001

# Migrations + (idempotent) seed run on every boot, then start the server.
RUN chmod +x ./docker-entrypoint.sh
CMD ["./docker-entrypoint.sh"]
