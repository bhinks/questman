# Questman

A gamified personal **life hub** — daily quests, XP, levels, streaks across
finance, workouts, chores, habits, projects, media consumption, daily vitals, 
and social connections. Self-hosted, single-user, dockerized with a cyberpunk 
aesthetic. Short for *Quest Manager*, with a nod to the Walkman.

## Quick start

1. Copy `.env.example` to `.env` and fill in `JWT_SECRET` (use `openssl rand -base64 48`).
   Optionally set `HUB_USER_EMAIL` / `HUB_USER_PASSWORD` to provision your account,
   and `ANTHROPIC_API_KEY` to enable Claude-themed daily quests.
2. `docker compose up -d --build`
3. Open `http://localhost:8080`.

## Features

### 🎯 **Quest System**
- AI-generated daily quests via Claude (with deterministic fallback)
- Day planner with time budgeting and priority ranking  
- Progress tracking with counter quests and focus timer
- Carry-over for must-do tasks and quest completion streaks

### 🎮 **Gamification**
- XP and leveling system with `100·n^1.5` progression curve
- Eddies (€$) — spendable currency for rewards
- Streak tracking and overclock multipliers
- Boss fights for major goals and milestones

### 📊 **Life Domains**
- **Finance**: CSV/Excel transaction import, spending analysis, categorization
- **Habits & Chores**: Recurring trackables with weather-aware scheduling
- **Workouts**: Exercise logging with XP rewards
- **Projects**: Task management with milestone tracking
- **Media**: Backlog with auto time-estimation (books, movies, games)
- **Daily Vitals**: Health metrics and biomonitoring
- **Social**: NPC relationship tracking and contact reminders

### 🤖 **AI Integration**
- Claude-powered quest theming and narrative
- Cross-domain insights and pattern analysis
- Weekly retrospective debriefs

## Layout

| Dir | What |
|---|---|
| `backend/` | Node + Express + Prisma (SQLite) + Socket.io + JWT. Quest engine, gamification core. |
| `web/` | React 19 + Vite frontend. Cyberpunk design system. |
| `docker-compose.yml` | Two services + persistent SQLite volume. |
| `.env.example` | Documented environment template. |

## Operating

```sh
docker compose up -d --build   # start (and rebuild on code changes)
docker compose logs -f backend # tail backend logs
docker compose down            # stop
docker compose down -v         # stop + wipe the SQLite volume (fresh slate)
```

Dev mode (without Docker): `npm run dev` in `backend/` and `web/`.
Backend on `:3001`, Vite on `:5173`. App at `http://localhost:5173`.

## Finance Module

### File Upload Format
The finance module accepts CSV or Excel files (.csv, .xlsx, .xls) with three required columns:

| Column | Description | Example |
|--------|-------------|---------|
| **Date** | Transaction date | 2024-01-15, 01/15/2024, January 15, 2024 |
| **Description** | Transaction description | "STARBUCKS SEATTLE WA", "Amazon.com purchase" |
| **Amount** | Transaction amount | -4.50 (expense), +2500.00 (income) |

**Supported date formats**: Most common date formats are automatically detected.  
**Amount format**: Negative for expenses, positive for income. Currency symbols and commas are handled automatically.

### Features
- **Smart Categorization**: Automatic transaction categorization with manual override
- **Spending Analysis**: Interactive charts and trends  
- **Wasteful Spending Detection**: AI-powered insights into spending patterns
- **Advanced Filtering**: Search by date, amount, category, or description

### Privacy & Security
- **Local Processing**: All data processing happens in your browser
- **No Server Storage**: Financial data never leaves your device  
- **No Tracking**: No analytics or tracking of financial information
- **Open Source**: Full transparency in data handling

## Weather Integration

Set `HUB_LAT` and `HUB_LON` in your `.env` file to enable weather-aware quest scheduling for outdoor chores and habits. Uses Open-Meteo (no API key required).
