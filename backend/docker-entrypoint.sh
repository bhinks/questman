#!/bin/sh
# =====================================================================
# Container entrypoint. Three steps:
#   1. Run committed migrations against the volume-backed SQLite file.
#      Uses `migrate deploy` (non-interactive, applies pending only)
#      not `migrate dev` (interactive, may rewrite history).
#   2. Provision the hub user iff HUB_USER_EMAIL + HUB_USER_PASSWORD are
#      set (idempotent). The demo sandbox is built on demand by the DEMO
#      button, not here. The `|| true` means a seed failure doesn't keep
#      the server from starting.
#   3. Start the server via tsx.
# =====================================================================
set -e

echo "[entrypoint] running prisma migrate deploy…"
npx prisma migrate deploy

echo "[entrypoint] seeding (idempotent)…"
npx tsx src/scripts/seed.ts || echo "[entrypoint] seed failed (continuing)"

echo "[entrypoint] starting server…"
exec npx tsx src/server.ts
