# bingo-reporter

A small Fabric mod that sits next to Yet Another Minecraft Bingo and uploads every finished round to the bingo-platform backend (`../backend`). It only uses YAB's public API (`me.jfenn.bingo.api`), so YAB itself is unmodified.

## Where to install it

On whichever computer runs the game: a dedicated server, or the player who clicks **Open to LAN**. Computers that only join don't need it, but it does nothing there, so it's fine to install it everywhere and let anyone host.

Requires: Minecraft 26.3, Fabric Loader ≥ 0.19, YAB ≥ 2.15 (YAB brings Fabric Language Kotlin with it).

The `bingout` 2.16.0 jar is also supported. Its gameplay mode is named **Draftout** (**Draftout 轮选** in Chinese); Bingout is the package/mod metadata name, not a second gameplay mode. The reporter records Draftout goals, the `draftout` mode tag and the 13-item card goal. It retains YAB's mod/API IDs, so the same reporter jar and configuration work with both. Older YAB releases without `isDraftMode` continue reporting their existing modes.

## Configure

First launch writes `.minecraft/config/bingo-reporter.json`:

```json
{
  "api_url": "https://bingo.dyrox.cat",
  "key": ""
}
```

Put your upload key in `key` (create one on the website's account page). For local development point `api_url` at `http://localhost:3000`. The file is re-read before every upload, so edits apply right away. With no key, rounds are still saved to the queue and sent once a key is added.

## Updates and the upload key

When the game starts, and every 6 hours after that, the reporter checks the website for a newer release (`/downloads/reporter.json`) and asks `/api/key` whether its upload key still works. The host (the singleplayer/LAN owner) and ops are told in chat when they join: a newer version, with a link to download it; a missing or rejected key; and, once per session, that the key is OK. `/bingo reporter` runs the check on demand. Other players hear nothing, since only whoever runs the game can fix either. Messages are in Chinese when the player's game language is Chinese, English otherwise (and in the server console).

## /bingo link

`/bingo link <code>` (typed by a player, code from the website's 账号 page) tells the website which Minecraft account belongs to which Discord account. The command hangs off YAB's own `/bingo` and needs this computer's upload key to be set. The game server vouches for who typed it, so only trust links made on servers you trust.

## What happens when a round ends

1. On YAB's `GAME_ENDED`, the reporter reads teams, scores, players, each team's card (all 25 cells with tier and which teams completed them) and the game options, on the server thread.
2. The round is written to `config/bingo-reporter/pending/<round id>.json`.
3. A background thread sends it to `POST {api_url}/api/matches` and deletes the file on success.
   - Server unreachable, 429 or 5xx → stays queued; retried every 5 minutes, after the next round and on the next start.
   - 401 (bad key) → stays queued until the key is fixed.
   - Other 4xx (invalid data) → moved to `config/bingo-reporter/failed/` and logged.

**Timeline:** while a round is running the reporter checks the cards and scores about once a second and records every change with YAB's in-game clock: which player got which goal, goals lost again, lines and cards scored. These go up with the round as `events`.

Rounds with no players are skipped. If a round is resumed and ends again, the newer result replaces the old one on the backend.

**Winner:** YAB doesn't expose "who won" in its API, so a team counts as the winner when the win condition is *N cards* and it completed at least N cards, which is the rule YAB uses. Infinite / replace-goals rounds have no winner.

**Known gap:** for multi-card goals, only each team's current card is reported; cards a team already finished aren't in YAB's public API.

## Build

```bash
./gradlew build      # → build/libs/bingo-reporter-<version>.jar
./gradlew test
```

Gradle runs on Java 25 (Loom requires it); `gradle/gradle-daemon-jvm.properties` makes Gradle download it automatically. `libs/bingo-api-*.jar` is YAB's API jar, copied out of `bingo-<version>.jar!/META-INF/jars/`; update it together with `bingo_api_version` in `gradle.properties` when targeting a newer YAB.
