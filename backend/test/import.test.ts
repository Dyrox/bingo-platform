import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDb, type DB } from "../src/db/client.ts";
import { sessions, users } from "../src/db/schema.ts";
import { createKey } from "../src/keys.ts";

const DYROX = "0537939b-26c6-4746-a45b-2e7aaebe0963";
const FRIEND = "8a4b6c2d-1e3f-4a5b-8c7d-9e0f1a2b3c4d";
const G1 = "11111111-0000-4000-8000-000000000001";
const G2 = "11111111-0000-4000-8000-000000000002";
const G3 = "11111111-0000-4000-8000-000000000003";

const OPTIONS = JSON.stringify({
  winCondition: { type: "cards", cards: 1 }, endGameWhen: { type: "first_win" }, stalemateBehavior: "END_GAME", timeLimit: "PT45M",
  cards: [{ goal: { type: "lines", lines: 3 }, isLockoutMode: true, isConsumeItemsMode: true }], isPvpEnabled: false, isNightVision: true, spawnDistance: 25,
});

type Row = { id: string; players: number; draw?: boolean; forfeit?: boolean; teams: [string, boolean][]; people: [string, string, string, number][] };

/** Writes a file with YAB's own schema (sqldelight V1__init.sqm + host_id), like config/yet-another-minecraft-bingo/bingo.db. */
function yabDb(dir: string, rows: Row[]) {
  const path = join(dir, `bingo-${Math.random()}.db`);
  const f = new DatabaseSync(path);
  f.exec(`CREATE TABLE Game (id TEXT NOT NULL PRIMARY KEY, bingo_options TEXT NOT NULL, bingo_options_hash TEXT NOT NULL, started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL, duration INTEGER NOT NULL, player_count INTEGER NOT NULL, is_draw INTEGER NOT NULL, is_forfeit INTEGER NOT NULL, host_id TEXT NOT NULL DEFAULT '');
    CREATE TABLE GameTeam (id TEXT NOT NULL, game_id TEXT NOT NULL, name TEXT NOT NULL, is_winner INTEGER NOT NULL, PRIMARY KEY (id, game_id));
    CREATE TABLE GamePlayer (team_id TEXT NOT NULL, game_id TEXT NOT NULL, minecraft_id TEXT NOT NULL, minecraft_name TEXT NOT NULL, captured_items INTEGER NOT NULL,
      PRIMARY KEY (team_id, game_id, minecraft_id));`);
  rows.forEach((r, i) => {
    f.prepare("INSERT INTO Game VALUES (?, ?, 'h', ?, ?, ?, ?, ?, ?, 'host')")
      .run(r.id, OPTIONS, `2026-0${i + 1}-01T10:00:00.123456789Z`, `2026-0${i + 1}-01T10:40:00.987654321Z`, 2_400_000, r.players, r.draw ? 1 : 0, r.forfeit ? 1 : 0);
    for (const [team, won] of r.teams) f.prepare("INSERT INTO GameTeam VALUES (?, ?, '{}', ?)").run(team, r.id, won ? 1 : 0);
    for (const [team, uuid, name, items] of r.people) f.prepare("INSERT INTO GamePlayer VALUES (?, ?, ?, ?, ?)").run(team, r.id, uuid, name, items);
  });
  f.close();
  return path;
}

let db: DB, app: ReturnType<typeof createApp>, cookie: string, dir: string;
beforeEach(async () => {
  db = await openDb({ pgliteDir: "memory://" });
  app = createApp(db);
  const [u] = await db.insert(users).values({ name: "Dyrox", discordId: "d1" }).returning();
  await db.insert(sessions).values({ tokenHash: createHash("sha256").update("tok").digest("hex"), userId: u.id, expiresAt: new Date(Date.now() + 86400e3) });
  cookie = "bingo_session=tok";
  dir = mkdtempSync(join(tmpdir(), "yab-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function importFile(path: string, withCookie = true) {
  const form = new FormData();
  form.set("file", new File([readFileSync(path)], "bingo.db"));
  return app.request("/api/me/import/yab", { method: "POST", body: form, headers: withCookie ? { cookie } : {} });
}
const profile = async (uuid: string) => (await app.request(`/api/players/${uuid}`)).json();

describe("importing YAB's bingo.db", () => {
  it("preserves Bingout's draft mode and 13-item win goal", async () => {
    const path = yabDb(dir, [{ id: G1, players: 1, teams: [["bingo_red", true]],
      people: [["bingo_red", DYROX, "Dyrox2333", 13]] }]);
    const file = new DatabaseSync(path);
    file.prepare("UPDATE Game SET bingo_options = ?").run(JSON.stringify({
      winCondition: { type: "cards", cards: 1 },
      cards: [{ goal: { type: "items", items: 13 }, isDraftMode: true, isLockoutMode: true }],
    }));
    file.close();
    expect((await importFile(path)).status).toBe(200);
    const m = await (await app.request(`/api/matches/${G1}`)).json();
    expect(m.options).toMatchObject({ winCondition: "cards:1", cardGoals: ["items:13"], mode: "lockout,draftout" });
  });

  it("imports a server's full history with all teams, results and settings", async () => {
    const path = yabDb(dir, [{ id: G1, players: 2, teams: [["bingo_red", true], ["bingo_blue", false]],
      people: [["bingo_red", DYROX, "Dyrox2333", 12], ["bingo_blue", FRIEND, "FriendMC", 7]] }]);
    const res = await importFile(path);
    expect(await res.json()).toEqual({ found: 1, imported: 1, replaced: 0, skipped: 0, partial: 0 , timelines: 0, failed: 0 });

    const m = await (await app.request(`/api/matches/${G1}`)).json();
    expect(m).toMatchObject({ source: "yab-stats", partial: false, durationMs: 2_400_000, boards: [], events: [], uploader: "Dyrox" });
    expect(m.teams.map((t: any) => [t.id, t.items, t.winner, t.players[0].name])).toEqual([["bingo_red", 12, true, "Dyrox2333"], ["bingo_blue", 7, false, "FriendMC"]]);
    expect(m.options).toMatchObject({ winCondition: "cards:1", endWhen: "first_win", stalemate: "end_game", cardGoals: ["lines:3"], mode: "lockout,consume_items", timeLimitSeconds: 2700, nightVision: true, pvp: false });
    expect((await profile(FRIEND)).allTime).toMatchObject({ games: 1, losses: 1 });
  });

  it("counts a client's own-team-only round as a loss when someone else must have won, and a stopped round as a draw", async () => {
    const path = yabDb(dir, [
      { id: G1, players: 3, teams: [["bingo_blue", false]], people: [["bingo_blue", DYROX, "Dyrox2333", 8]] },
      { id: G2, players: 3, forfeit: true, teams: [["bingo_blue", false]], people: [["bingo_blue", DYROX, "Dyrox2333", 4]] },
      { id: G3, players: 3, teams: [["bingo_aqua", true]], people: [["bingo_aqua", DYROX, "Dyrox2333", 9]] },
    ]);
    expect(await (await importFile(path)).json()).toMatchObject({ imported: 3, partial: 3 });
    const m = await (await app.request(`/api/matches/${G1}`)).json();
    expect(m.teams.map((t: any) => [t.id, t.winner])).toEqual([["bingo_blue", false], ["unknown", true]]);
    expect((await profile(DYROX)).history.map((h: any) => h.result)).toEqual(["loss", "draw", "win"]);
  });

  it("is idempotent, never touches rounds the reporter uploaded, and lets a fuller copy replace a partial one", async () => {
    // the reporter already uploaded G1 (with a card)
    const key = (await createKey(db, "host", "pc")).key;
    const sample = JSON.parse(readFileSync(new URL("../examples/match.json", import.meta.url), "utf8"));
    sample.id = G1;
    await app.request("/api/matches", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(sample) });

    const mine = yabDb(dir, [
      { id: G1, players: 2, teams: [["bingo_red", false]], people: [["bingo_red", DYROX, "Dyrox2333", 1]] },
      { id: G2, players: 2, teams: [["bingo_red", false]], people: [["bingo_red", DYROX, "Dyrox2333", 5]] },
    ]);
    expect(await (await importFile(mine)).json()).toEqual({ found: 2, imported: 1, replaced: 0, skipped: 1, partial: 1 , timelines: 0, failed: 0 });
    expect(await (await importFile(mine)).json()).toEqual({ found: 2, imported: 0, replaced: 0, skipped: 2, partial: 0 , timelines: 0, failed: 0 });
    expect((await (await app.request(`/api/matches/${G1}`)).json()).boards).toHaveLength(1); // still the reporter's

    // the server owner's copy of G2 knows both teams
    const server = yabDb(dir, [{ id: G2, players: 2, teams: [["bingo_red", false], ["bingo_blue", true]],
      people: [["bingo_red", DYROX, "Dyrox2333", 5], ["bingo_blue", FRIEND, "FriendMC", 11]] }]);
    expect(await (await importFile(server)).json()).toMatchObject({ replaced: 1 });
    const g2 = await (await app.request(`/api/matches/${G2}`)).json();
    expect(g2.partial).toBe(false);
    expect(g2.teams.map((t: any) => t.id)).toEqual(["bingo_red", "bingo_blue"]);
  });

  it("lets a later reporter upload replace an import, even from someone else's key", async () => {
    await importFile(yabDb(dir, [{ id: G1, players: 1, teams: [["bingo_red", true]], people: [["bingo_red", DYROX, "Dyrox2333", 3]] }]));
    const key = (await createKey(db, "other-host", "pc")).key;
    const sample = JSON.parse(readFileSync(new URL("../examples/match.json", import.meta.url), "utf8"));
    sample.id = G1;
    const res = await app.request("/api/matches", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(sample) });
    expect(res.status).toBe(200);
    expect((await (await app.request(`/api/matches/${G1}`)).json()).source).toBe("reporter");
  });

  it("imports a round that was left running for weeks (longer than a 32-bit millisecond count)", async () => {
    const path = yabDb(dir, [{ id: G1, players: 1, teams: [["bingo_red", false]], people: [["bingo_red", DYROX, "Dyrox2333", 3]] }]);
    const f = new DatabaseSync(path); f.prepare("UPDATE Game SET duration = ?").run(2_172_815_335); f.close();
    expect(await (await importFile(path)).json()).toMatchObject({ imported: 1, failed: 0 });
    expect((await (await app.request(`/api/matches/${G1}`)).json()).durationMs).toBe(2_172_815_335);
    expect((await profile(DYROX)).allTime.playtimeMs).toBe(2_172_815_335);
  });

  it("rejects other files and logged-out uploads", async () => {
    const txt = join(dir, "x.db");
    (await import("node:fs")).writeFileSync(txt, "hello");
    expect((await importFile(txt)).status).toBe(400);
    const other = join(dir, "other.db");
    const f = new DatabaseSync(other); f.exec("CREATE TABLE t (x)"); f.close();
    expect(await (await importFile(other)).json()).toMatchObject({ error: "not_yab" });
    expect((await importFile(yabDb(dir, []), false)).status).toBe(401);
  });
});

describe("timelines from the server's logs", () => {
  // rounds in UTC; the server's clock is UTC+8, like the real one
  const R1 = { id: G1, players: 2, teams: [["bingo_blue", false], ["bingo_pink", true]] as [string, boolean][],
    people: [["bingo_blue", DYROX, "Dyrox2333", 2], ["bingo_pink", FRIEND, "BugJump", 3]] as [string, string, string, number][] };
  const R2 = { id: G2, players: 1, teams: [["bingo_blue", true]] as [string, boolean][], people: [["bingo_blue", DYROX, "Dyrox2333", 1]] as [string, string, string, number][] };

  /** YAB's ScoredItemCheck lines for R1: playing at 23:59:50 local, ends 00:40:00 the next day (= 16:40:00Z, 40 min 10 s). */
  const log = [
    "[23:59:40] [Server thread/INFO]: GameState changed: LOADING -> COUNTDOWN",
    "[23:59:50] [Server thread/INFO]: GameState changed: COUNTDOWN -> PLAYING",
    "[00:00:10] [Server thread/INFO]: [ScoredItemCheck] Dyrox2333 got minecraft:birch_stairs",
    "[00:00:10] [Server thread/INFO]: [ScoredItemCheck] Updated score for team bingo_blue: TeamScore(items=1, lines=0, cards=0)",
    "[00:01:00] [Server thread/INFO]: [ScoredItemCheck] BugJump got minecraft:beef",
    "[00:01:00] [Server thread/INFO]: [ScoredItemCheck] Updated score for team bingo_pink: TeamScore(items=1, lines=0, cards=0)",
    "[00:05:00] [Server thread/INFO]: [ScoredItemCheck] BugJump got yet-another-minecraft-bingo:challenge/all_wooden_tools",
    "[00:05:00] [Server thread/INFO]: [ScoredItemCheck] Updated score for team bingo_pink: TeamScore(items=2, lines=1, cards=0)",
    "[00:20:00] [Server thread/INFO]: [ScoredItemCheck] Dyrox2333 got minecraft:beef",
    "[00:20:00] [Server thread/INFO]: [ScoredItemCheck] Updated score for team bingo_blue: TeamScore(items=2, lines=0, cards=0)",
    "[00:40:00] [Server thread/INFO]: [ScoredItemCheck] BugJump got minecraft:cake",
    "[00:40:00] [Server thread/INFO]: [ScoredItemCheck] Updated score for team bingo_pink: TeamScore(items=3, lines=4, cards=0)",
    "[00:40:00] [Server thread/INFO]: [ScoredItemCheck] Team bingo_pink has completed their card",
    "[00:40:00] [Server thread/INFO]: Writing game result to stats.db...",
    "[00:40:00] [Server thread/INFO]:   Game duration: 40m 0s",
  ].join("\n");

  /** bingo.db rows with R1 ending at 16:40:00Z (00:40 at UTC+8) after 40 min. */
  function serverDb(rows: Row[], ends: string[]) {
    const path = yabDb(dir, rows);
    const f = new DatabaseSync(path);
    rows.forEach((r, i) => f.prepare("UPDATE Game SET ended_at = ?, duration = ? WHERE id = ?").run(ends[i], 2_400_000, r.id));
    f.close();
    return path;
  }
  async function importWithLogs(dbPath: string, logs: { name: string; text: string }[]) {
    const form = new FormData();
    form.set("file", new File([readFileSync(dbPath)], "bingo.db"));
    const { gzipSync } = await import("node:zlib");
    for (const l of logs) form.append("logs", new File([l.name.endsWith(".gz") ? gzipSync(l.text) : l.text], l.name));
    return (await app.request("/api/me/import/yab", { method: "POST", body: form, headers: { cookie } })).json();
  }

  it("rebuilds who got what when, lines and the card, and fills in line/card counts", async () => {
    const path = serverDb([R1, R2], ["2026-10-20T16:40:00.000Z", "2026-03-01T12:00:00.000Z"]);
    expect(await importWithLogs(path, [{ name: "2026-10-21-1.log.gz", text: log }])).toMatchObject({ imported: 2, timelines: 1 });

    const m = await (await app.request(`/api/matches/${G1}`)).json();
    expect(m.events.map((e: any) => [e.t, e.type, e.team, e.player, e.objectiveId, e.value])).toEqual([
      [20_000, "goal", "bingo_blue", DYROX, "minecraft:birch_stairs", null],
      [70_000, "goal", "bingo_pink", FRIEND, "minecraft:beef", null],
      [310_000, "goal", "bingo_pink", FRIEND, "yet-another-minecraft-bingo:challenge/all_wooden_tools", null],
      [310_000, "line", "bingo_pink", null, null, 1],
      [1_210_000, "goal", "bingo_blue", DYROX, "minecraft:beef", null],
      [2_410_000, "goal", "bingo_pink", FRIEND, "minecraft:cake", null],
      [2_410_000, "line", "bingo_pink", null, null, 4],
      [2_410_000, "card", "bingo_pink", null, null, 1],
    ]);
    expect(m.teams.map((t: any) => [t.id, t.lines, t.cards])).toEqual([["bingo_blue", 0, 0], ["bingo_pink", 4, 1]]);
    expect((await (await app.request(`/api/matches/${G2}`)).json()).events).toEqual([]);
    // the leaderboard's fastest line now comes from the imported timeline
    const pink = (await (await app.request("/api/leaderboard")).json()).players.find((p: any) => p.uuid === FRIEND);
    expect(pink.fastestLineMs).toBe(310_000);
  });

  it("adds a timeline to an earlier import that had none, and is idempotent after that", async () => {
    const path = serverDb([R1], ["2026-10-20T16:40:00.000Z"]);
    expect(await importWithLogs(path, [])).toMatchObject({ imported: 1, timelines: 0 });
    expect(await importWithLogs(path, [{ name: "latest.log", text: log }])).toMatchObject({ replaced: 1, timelines: 1 });
    expect(await importWithLogs(path, [{ name: "latest.log", text: log }])).toMatchObject({ skipped: 1, replaced: 0 });
  });

  it("leaves out a log round that fits more than one game", async () => {
    // two rounds with the same end time of day (different days), length and scores
    const twin = { ...R1, id: G3 };
    const path = serverDb([R1, twin], ["2026-10-20T16:40:00.000Z", "2026-10-21T16:40:00.000Z"]);
    expect(await importWithLogs(path, [{ name: "x.log", text: log }])).toMatchObject({ imported: 2, timelines: 0 });
  });
});
