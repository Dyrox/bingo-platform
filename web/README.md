# web

The bingo platform website: match list, match detail (teams, scores, the 5×5 card with goal names and icons) and player pages. React + TypeScript + Vite, talking to `../backend`.

## Run locally

```bash
cd ../backend && npm run dev     # API on :3000
npm install && npm run dev       # site on :5173, /api is proxied to :3000 (override with API_URL)
```

## Pages

| Path | |
|---|---|
| `/matches` | all matches, newest first, "load more" pages through `GET /api/matches` |
| `/matches/:id` | one round: replay (scrub or play the round at 10–60×; cards, scores and timeline follow), timeline (hover an entry to flash its tile), one card per team drawn with the mod's own art (frame per team colour, green completed tiles, star / forbidden frames, WINNER! tag), scores, settings |
| `/` | "我的主页": logged out → Discord login; logged in without a character → `/bingo link` code; linked → your player page. Who you are only ever comes from the account. |
| `/players/:uuid` | profile: totals, this month, opponents, strongest / toughest goals, activity heatmap, items-per-game trend |
| `/leaderboard` | all-time or this-month ranking, sortable by any column |
| `/players/:uuid/records/:id?` | records: the player's matches by day, with the picked match shown alongside |
| `/players` | everyone who has played |
| `/guide` | tier guide of every goal, with how each has gone in real matches (seen / completed / average time) and sorting by it |
| `/account` | Discord login, linked Minecraft characters (with the `/bingo link` code flow) and upload keys |

中文 / EN is remembered per browser. Team ids like `bingo_red` are shown as 红队 / Red (`src/teams.ts`).

## Goal names and icons

`public/goals/<yab version>/` holds `goals.json` (id → names, tier, groups, icon recipe) and one PNG per icon. They're generated from the mod and game jars by [`tools/goal-data`](../tools/goal-data/README.md), then imported with `node scripts/import-goals.mjs data.json icons.json <yab version>`.

A match is drawn with the goal data for its YAB release (`2.15.1+mc26.3` → `2.15.1`); unknown releases fall back to the newest one available. Composite icons (any of / all of / never) use the same geometry as the mod's own renderer.

## Mod art

`public/yab/` holds textures copied from the YAB jar (`assets/minecraft/textures/gui/sprites/bingo/`: the `card_*_shadowed` frames, star and forbidden frames, tooltip) and Minecraft's `font/ascii.png`; `src/card_colors.json` is the mod's `gui/card_colors.json`. Card layout follows the mod's `ClientCardBufferRenderer` (122×132 frame, tiles at 12 + 20·x, 22 + 20·y). Copy them again when YAB changes its art.

Player faces come from mc-heads.net.
