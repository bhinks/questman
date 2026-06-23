#!/usr/bin/env bash
# NovaHQ app-unit deploy hook — the drop-in that makes an app repo (questman, rancor,
# intronet, …) auto-deploy on the box. COPY this verbatim into the app repo as
# `ops/deploy/on-pull.sh` (chmod +x). It is the per-app twin of novahq's own
# ops/deploy/on-pull.sh.
#
# How it fires: nova-gitsync fast-forwards every checkout under /srv/projects, and after
# a successful ff of a repo it runs that repo's ops/deploy/on-pull.sh OLD NEW. So once
# this app is a git checkout at /srv/projects/<slug>, any pulled change triggers this.
#
# What it does: it runs as `nova` inside the NoNewPrivileges gitsync sandbox, so it
# CANNOT sudo or touch the apps-plane docker. Instead it drops a redeploy marker named
# for this app's slug into the deploy queue; the root nova-redeploy.path actuator drains
# it by running `nova deploy <slug>` (validated against `nova apps`). If the actuator
# isn't installed, this is a harmless no-op — the change is still pulled; deploy by hand
# with `nova deploy <slug>`.
#
# The slug is the checkout's directory name (= the nova registry slug). Override with
# NOVA_APP_SLUG only if the box checkout dir can't match the registered slug.
set -uo pipefail

SLUG="${NOVA_APP_SLUG:-$(basename "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)")}"
Q=/srv/nova/.nova-deploy-queue

if systemctl is-active --quiet nova-redeploy.path 2>/dev/null \
   && [ -d "$Q" ] && : >"$Q/$SLUG" 2>/dev/null; then
  printf 'on-pull: enqueued redeploy of %s (root nova-redeploy.path will build it)\n' "$SLUG"
else
  printf 'on-pull: %s changed — auto-redeploy not active; deploy by hand: nova deploy %s\n' "$SLUG" "$SLUG"
fi
exit 0
