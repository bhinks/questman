# Daymon

A gamified personal **life hub** with a cyberpunk aesthetic. Daymon turns the
scattered inputs of a day — quests, habits, chores, projects, workouts, vitals,
media, finances, and the people you keep up with — into one ranked daily board,
and wraps it in an XP/eddies economy so doing the work actually feels like
playing. Self-hosted, single-user, dockerized. The name is *day* + *daemon* — the
background process that runs your days.

![The Today board — priority contract, day-planner ledger, weather scan, power cell, and session log](docs/screenshots/today.png)
*TODAY: the day's quests ranked by the planner, an AI Handler briefing, a
weather-aware schedule, the power cell, and the live session log.*

## Quick start

1. `cp .env.example .env` and set **`JWT_SECRET`** (`openssl rand -base64 48`),
   your **`HUB_USER_EMAIL` / `HUB_USER_PASSWORD`**, and **`TZ`** (your real
   timezone — daily quests roll over at local midnight). Everything else is
   optional; see [Configuration](#configuration).
2. `docker compose up -d --build`
3. Open `http://localhost:8080` and **JACK IN** with your hub credentials.

AI is **off by default** and turns on nothing until you opt in — see
[What the AI sees](#what-the-ai-sees).

## How it works

**The daily loop.** Open Today and the engine has already assembled your day:
every domain you track feeds candidate quests into one **day planner** that ranks
them (must-do first, then deadlines, weather windows, reward, and shorter tasks)
and fits them to a time budget (4h weekdays / 10h weekends, minus any calendar
commitments). It suggests **what** to do, never **when**. You complete, advance
(counter quests tick `+1` toward a target), **skip**, or **reroll** — and **JACK
IN** to the **Focus Chamber** for a distraction-free timer (count up, or count
down a 15/25/40/55-min limit) that logs real time against estimates.

**The economy.** Completing work earns **XP** (permanent progression on a
`100·n^1.5` curve) and **eddies (€$)** (spendable currency). A full-clear day
ramps an **overclock** multiplier on eddie earns (and banks an R&R credit); a
miss cools it. Big goals become **bosses** with HP you grind down or charge up;
milestones pay out. **Street Cred** is the achievement wall and analytics
(XP velocity, per-module XP, an activity heat grid, and an immutable ledger of
every grant). The **Night Market** is the eddie sink: neon skins, OS shells,
ambient FX, focus-timer faces, Handler personas, data pets, and burnout-relief
consumables (skip/reroll tokens, R&R downtime credits).

**The AI Handler.** A sardonic rogue-AI persona narrates a daily rundown and a
weekly debrief, and surfaces honest cross-domain **insights** ("spend climbs on
low-sleep days — possible pattern"). It only ever *narrates* server-computed
facts — it can't mint XP or eddies, and it sees nothing you haven't granted.

### Life domains (the deck)

| Group | Screen | What it tracks |
|---|---|---|
| **OPS** | Today · Bosses · Handler | the daily board, boss fights, and the Handler feed + weekly debrief |
| **LIFE** | **Habits** | recurring habits ("daemons") and anti-goals ("ICE" — things to avoid; a slip is a "breach") |
| | **Operations** | projects (with sequenced step-tracks + milestones) and their attached chores |
| | **Health** | the Biomonitor — daily vitals/metrics with trend charts, plus workout logging |
| | **Media** | the Braindance backlog — books/movies/shows/games with auto-estimated time-to-finish and a "what fits in N minutes" planner |
| | **Social** | the Crew — keep-in-touch contacts with cadence tracking and reach-out nudges |
| **VAULT** | Finance · Budgets · Bills · Savings | CSV/Excel import, categorization, monthly burn, budget envelopes, recurring-bill detection |
| **PROGRESSION** | Street Cred · Shop | achievements + analytics, and the Night Market |
| **SYSTEM** | Calibration | CRT/display tuning and the AI Calibration panel |

Everything is closed-loop: do the underlying thing (log a workout, pay a bill,
finish a project task) and the matching quest clears itself and pays out.

## Screenshots

| | |
|:--|:--|
| ![Focus Chamber — distraction-free deep-work timer](docs/screenshots/focus.png) **Focus Chamber** — jack in from anywhere for a distraction-free run; sessions roll up into actual-time-spent per project, habit, chore, or workout. | ![Night Market shop](docs/screenshots/shop.png) **Night Market** — sink eddies into burnout-relief tokens, consumables, loot, and cosmetics: neon skins, fonts, ambient FX, and focus-timer faces. |
| ![Today board reskinned with the Synthwave theme](docs/screenshots/today-synthwave.png) **Live reskins** — every equipped skin remaps the whole HUD's accent palette (Synthwave shown). | ![The Vault — finance dashboard](docs/screenshots/finance.png) **The Vault** — CSV/Excel import with auto-categorization, monthly burn, budgets, bills, and recurring-drain detection. |

![Street Cred — XP velocity, per-module XP, activity grid, data-shard ledger](docs/screenshots/progress.png)
*Street Cred: XP velocity, per-module lifetime XP, the activity heat grid, and the
immutable data-shard ledger every grant is written to.*

## Configuration

All settings live in `.env` (copied from `.env.example`, where every variable is
documented inline). Unset optional variables degrade gracefully — the app never
blocks on an external feed.

### Required

| Variable | How to set it |
|---|---|
| `JWT_SECRET` | 32+ random chars: `openssl rand -base64 48` |
| `HUB_USER_EMAIL` / `HUB_USER_PASSWORD` / `HUB_USER_NAME` | your login; the seed provisions this account on first boot |
| `TZ` | your IANA timezone (e.g. `America/New_York`) — all day-based logic uses local midnight here |

### AI (optional — off until you opt in)

| Variable | How to get it |
|---|---|
| `ANTHROPIC_API_KEY` | create a key in the Anthropic Console (<https://platform.claude.com/>). The key alone enables nothing; you still flip the switches in SYS // CALIBRATION. |
| `ANTHROPIC_MODEL` | defaults to `claude-opus-4-8`; `claude-sonnet-4-6` or `claude-haiku-4-5` for lighter/cheaper use |

Prefer to keep AI fully on-box? Point Daymon at a local **[Ollama](https://ollama.com)**
node instead (URL + model, set in the AI Calibration panel) — zero cloud egress.
A daily token cap (also in-panel) backstops cost.

### Weather-aware chores (optional, keyless)

Set `HUB_LAT` / `HUB_LON` (decimal degrees, e.g. `40.71` / `-74.01`). Uses
[Open-Meteo](https://open-meteo.com) — no key. Outdoor chores then only generate
quests when their weather rule passes, and the planner picks the best window.

### Calendar (optional)

Set `CALENDAR_ICS_URL` to one or more (comma-separated) **private ICS feeds**.
For Google Calendar: *Settings → your calendar → "Integrate calendar" → "Secret
address in iCal format."* Treat that URL like a password. Read-only; it shrinks
the planner's time budget by your real busy time and shows a GRID SCHEDULE
agenda. (The AI only ever sees commitment counts/free-busy, never event titles.)

### Health sync (optional)

Auto-fill vitals from a Pixel Watch / Health Connect. Pair the
[health-connect-webhook](https://github.com/mcnaveen/health-connect-webhook)
Android app and set a shared secret (`INGEST_TOKEN`, 16+ chars:
`openssl rand -hex 24`). Recommended route for a plain-HTTP hub is **pull mode**:
enable the app's **Local HTTP Server**, give your phone a DHCP reservation, and
set `HEALTH_PULL_URL` (+ optional `HEALTH_PULL_TOKEN`, `HEALTH_PULL_MINUTES`,
`HEALTH_BACKFILL_DAYS`). The backend polls the phone, backfills history, and
re-syncs idempotently. Steps/sleep/HR/weight/BP/hydration map straight onto your
daily metrics. (HTTPS hubs can use push mode instead; both are detailed in
`.env.example`.)

### Media time-estimation (optional)

- **Books** — [Open Library](https://openlibrary.org), keyless. Nothing to set.
- **Movies & shows** — [TMDb](https://www.themoviedb.org/settings/api): create a
  free account, request a v3 API key, set `TMDB_API_KEY`.
- **Games** — [IGDB](https://www.igdb.com) via a free Twitch app
  (<https://dev.twitch.tv/console/apps>): create an app, copy the **Client ID**,
  generate a **Client Secret**, set `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`.

Each source falls back to manual entry when unset or when a title isn't found.

### Networking

`WEB_PORT` (default `8080`) and `JWT_EXPIRES_IN` (default `30d`).

## What the AI sees

**Nothing, by default.** Every AI layer ships disabled. To use it you opt in
deliberately in **SYS // CALIBRATION → AI Calibration**:

1. flip the **AI SYSTEMS** master breaker on,
2. enable the features you want (**Quest Synthesis**, **Handler Uplink**),
3. open the per-domain **data-access grants** you're comfortable with.

Even fully enabled, the model only receives **server-computed summaries** — never
raw tables, files, or history — and it cannot mint XP or eddies.

| Grant | Default | When OPEN, prompts may include |
|---|---|---|
| **Vault** (finance) | sealed | wasteful-pattern + budget/bill summaries, weekly spend total + top categories. Never raw transactions. |
| **Biometrics** (health) | sealed | vitals/workout quest prompts, energy tier, weekly sleep/mood averages + weight delta. Never full history. |
| **Contacts** (social) | sealed | the most-neglected contact's name + days since contact. |
| **Grid Schedule** (calendar) | sealed | commitment count, next start time, free/busy minutes. Event titles: never. |

Sealed domains are partitioned out *before* any prompt is built; a sealed
calendar is never even fetched. With everything off (the default), the app still
works fully — quests use rule-based titles and the Handler stays quiet.

## Operating

```sh
docker compose up -d --build      # start / rebuild after code changes
docker compose logs -f backend    # tail backend logs
docker compose down               # stop
docker compose down -v            # stop + wipe the data volume (fresh slate)
```

Dev mode (no Docker): `npm run dev` in both `backend/` and `web/` — backend on
`:3001`, Vite on `:5173`. A seeded **demo account** (`demo@daymon.app` /
`demo123`) exists for clicking around without your real data; run
`npm run db:seed` in `backend/` to (re)create it.

## Stack & layout

| Dir | What |
|---|---|
| `backend/` | Node + Express + Prisma (SQLite) + Socket.io + JWT. Quest engine, gamification core, AI gateway. |
| `web/` | React 19 + Vite + TypeScript. A ~1,500-line hand-authored cyberpunk design system (no Tailwind utilities) — clipped panels, a calibratable CRT frame, neon skins, and stackable ambient FX. |
| `docker-compose.yml` | two services + a persistent SQLite volume. |
| `.env.example` | the documented environment template. |

### Privacy posture

Self-hosted: your data lives in a SQLite volume on your own hardware — no
third-party service sees it. No analytics, no telemetry. AI is opt-in per
feature and per domain. The server owns the entire economy; the model only
narrates.
