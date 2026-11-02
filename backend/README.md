# bingo-backend

Match history API for Yet Another Minecraft Bingo. bingo-reporter uploads each finished round here; the website reads it back.

Stack: Node 22 + TypeScript, Hono, Drizzle ORM, Postgres. Locally it runs on embedded PGlite (Postgres compiled to WASM), so no database install is needed.

## Discord login (one-time setup)

1. https://discord.com/developers/applications → **New Application** (any name, e.g. "Bingo Platform").
2. **OAuth2** → copy **Client ID**, click **Reset Secret** and copy the **Client Secret**.
3. **OAuth2 → Redirects** → add `http://localhost:5173/api/auth/discord/callback` (and later your real site's `https://…/api/auth/discord/callback`). Save.
4. `cp .env.example .env` and fill in `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `PUBLIC_URL`. Restart `npm run dev`.

Without these the site works as before, just without the login button.

## Run locally

```bash
npm install
npm run key:create -- dyrox "MacBook Air"   # prints an upload key once
npm run dev                                  # http://localhost:3000, data in ./data/pglite
BINGO_KEY=bgr_... npm run upload:sample      # sends examples/match.json
npm test
```

## API

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/api/health` | – | liveness |
| POST | `/api/matches` | `Authorization: Bearer <upload key>` | store a finished round. 201 created, 200 replaced (same uploader re-sent it, e.g. after a resume), 400 invalid, 401 bad key, 409 another user owns that round or board id |
| GET | `/api/matches?player=<uuid>&limit=20&before=<iso>` | – | newest first; `next` in the response is the `before` for the following page |
| GET | `/api/matches/:id` | – | full round: teams, players, boards with every cell, and the timeline (`events`, empty for rounds uploaded before the reporter tracked it) |
| GET | `/api/auth/discord` → `/api/auth/discord/callback` | – | Discord login; sets an httpOnly session cookie and returns to `/account` |
| POST | `/api/auth/logout` | session | |
| GET | `/api/me` | session (optional) | `{ user: null }` when logged out; otherwise the account, its linked Minecraft players and upload keys |
| POST | `/api/me/link-code` | session | a 6-character code, valid 10 minutes, for `/bingo link <code>` |
| DELETE | `/api/me/players/:uuid` | session | unlink a Minecraft character |
| POST / DELETE | `/api/me/keys`, `/api/me/keys/:id` | session | create (key shown once) / revoke upload keys |
| POST | `/api/link` | upload key | sent by bingo-reporter when a player types `/bingo link <code>`: links that player's UUID to the code's account |
| GET | `/api/players` | – | everyone who has played, with game counts, most recently active first |
| GET | `/api/players/:uuid` | – | all-time and this-month totals (W/L/D, items, playtime, streaks, favourite team) plus a per-match history for charts |

The upload body is documented by `src/payload.ts` and shown in `examples/match.json`. `id` is YAB's round id and each board `id` is YAB's card id, so retries are safe and a resumed round replaces its earlier result.

## Data

`src/db/schema.ts` is the source of truth. After changing it run `npm run db:generate`; migrations in `drizzle/` are applied automatically on startup.

- `users`, `upload_keys` (SHA-256 of each key, one per computer)
- `players` (Minecraft UUID → latest name, optional link to a user)
- `matches`, `match_teams`, `match_players`
- `boards`, `board_cells` (objective id, tier, which teams completed it)

## Deploy

Production runs at https://bingo.dyrox.cat. Every push to `main` goes through `.github/workflows/deploy.yml`: tests → reporter jar → one Docker image (API + built site + jar, see the root `Dockerfile`) → GHCR → `docker compose up` on the VPS in `/opt/bingo-platform` (`deploy/compose.yml`). nginx on the VPS proxies the domain to `127.0.0.1:3100` (`deploy/nginx-bingo.dyrox.cat.conf`); the app uses the host's Postgres. `/opt/bingo-platform/.env` (see `deploy/.env.example`) is kept on the server only.

In production the backend also serves the website (`WEB_DIST`), so the site and `/api` share one address.
