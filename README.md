# bingo-platform

A match-history site for [Yet Another Minecraft Bingo](https://modrinth.com/mod/yet-another-minecraft-bingo) (YAB): every round you play is uploaded automatically, and the website shows each match (team cards drawn in the mod's own style, a timeline of who got what when), player pages with stats, and a tier guide of every goal.

| Folder | What |
|---|---|
| [`reporter/`](reporter/README.md) | **bingo-reporter**, a small Fabric mod installed next to YAB. Records each round and uploads it; adds `/bingo link <code>`. |
| [`backend/`](backend/README.md) | API + database (Node, Hono, Postgres/PGlite). Stores matches, players, Discord accounts, upload keys. |
| [`web/`](web/README.md) | The website (React + Vite): my page, records, match pages, players, tier guide, account. |
| [`tools/goal-data/`](tools/goal-data/README.md) | Scripts that extract goal names, tiers and icons from the mod and game jars for the website. |

## How it fits together

```
Minecraft (YAB + bingo-reporter) ──POST /api/matches, /api/link──▶ backend ◀──/api──▶ web
         on whoever hosts the game          (upload key)                         (Discord login)
```

1. Log in on the website with Discord, then link your Minecraft character by typing `/bingo link <code>` in game.
2. On the account page, create an upload key for each computer that hosts games and put it in `.minecraft/config/bingo-reporter.json`.
3. Play. Each finished round shows up on the site.

## Run locally

```bash
cd backend && npm install && cp .env.example .env   # fill in Discord app values, see backend/README.md
npm run dev                                           # API on :3000
```
```bash
cd web && npm install && npm run dev                  # site on :5173
```
```bash
cd reporter && ./gradlew build                        # → build/libs/bingo-reporter-<version>.jar
```
