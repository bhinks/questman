---
name: screenshot-capture
description: Regenerate the Daymon (formerly Questman) README screenshots (docs/screenshots/*.png) from the live running app. Use when asked to update, refresh, recapture, or fix the docs/marketing screenshots, or after UI changes that should be reflected there.
---

# Daymon screenshot capture

Regenerates `docs/screenshots/*.png` by driving the **live app** with headless
Chromium (puppeteer). Output matches the existing **1170×720 @2×** framing
(→ 2340×1440). The captured set: `today`, `today-synthwave`, `shop`, `finance`,
`progress` (Street Cred), `focus` (the Chamber).

## 1. Prerequisites

**App running at `http://localhost:8080`:**
```sh
docker compose up -d --build      # or dev mode (:5173) — then `BASE=http://localhost:5173`
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/   # expect 200
```

**Puppeteer installed in this skill dir** (first run only; ~170MB Chromium):
```sh
cd .claude/skills/screenshot-capture && npm install
```

## 2. Capture (to a staging dir)

```sh
cd .claude/skills/screenshot-capture && node capture.mjs
```
Writes staged PNGs to `.claude/skills/screenshot-capture/shots/` (gitignored).

## 3. Verify — do not skip

**Read each staged PNG** (the Read tool renders images) and confirm:
- authenticated (not the JACK IN login screen),
- real demo data present (not empty/error states),
- correct theme (base cyan for `today.png`, magenta for `today-synthwave.png`),
- no stray noise.

This step has caught real problems — e.g. stacked shop FX rendering as static
visual noise. If a shot is wrong, fix `capture.mjs` and re-run before promoting.

## 4. Promote

```sh
cp shots/*.png ../../../docs/screenshots/      # from the skill dir
```

## How it works / gotchas

- **Auth:** logs in via `POST /api/auth/login` as the demo account
  (`demo@daymon.app` / `demo123`) and injects the JWT into
  `localStorage['questman.auth.token']`, then reloads.
- **Navigation:** the SPA has no URL routes (`activeTab` is React state), so the
  script clicks deck items by their visible **label** (e.g. `Shop`,
  `Street Cred`). If a screen is renamed, update the label in `capture.mjs`.
- **Theme variants:** `data-theme` is toggled on `<html>` (mutation-free) — no
  shop purchase, no DB write.
- **Shop ambient FX read as static noise** in a still frame, so the script hides
  `.fxo` (drizzle / rain / matrix / dust / VHS). The **base** CRT frame,
  scanlines, corner glow, and headline chroma are intentionally kept — that's the
  design look, not the shop layer. (Ghost-cursor + glitch are event-driven and
  never render in a static headless shot.)
- **Config** (BASE, credentials, viewport, the ordered shot list with nav labels
  + themes) is the `CONFIG` object at the top of `capture.mjs`. Edit there to add
  a screen, change framing, or point at dev mode.
