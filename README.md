# Questman

A gamified personal **life hub** — daily quests, XP, levels, streaks across
finance, workouts, chores, and habits. Self-hosted, single-user, dockerized.
Cyberpunk-themed. Short for *Quest Manager*, with a nod to the Walkman.

## Quick start

1. Copy `.env.example` to `.env` and fill in `JWT_SECRET` (use `openssl rand -base64 48`).
   Optionally set `HUB_USER_EMAIL` / `HUB_USER_PASSWORD` to provision your account,
   and `ANTHROPIC_API_KEY` to enable Claude-themed daily quests.
2. `docker compose up -d --build`
3. Open `http://localhost:8080`.

## Layout

| Dir | What |
|---|---|
| `backend/` | Node + Express + Prisma (SQLite) + Socket.io + JWT. Quest engine, gamification core. |
| `web/` | React 19 + Vite frontend. Cyberpunk design system. |
| `findash-design/` | Original design exploration (archived). |
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

## History

This started life as **FinDash**, a finance dashboard with a strong cyberpunk
"Finance Terminal" aesthetic. It then pivoted into a broader gamified life
hub — finance became one of several modules alongside workouts, chores, and
habits, all wrapped in a daily-quest layer powered by Claude. See `web/README.md`
for the original FinDash docs.
