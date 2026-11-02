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
  cards: [{ goal: { type: "lines", lines: 3 }, isLockoutMode: true }], isPvpEnabled: false, isNightVision: true, spawnDistance: 25,
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
  it("imports a server's full history with all teams, results and settings", async () => {
    const path = yabDb(dir, [{ id: G1, players: 2, teams: [["bingo_red", true], ["bingo_blue", false]],
      people: [["bingo_red", DYROX, "Dyrox2333", 12], ["bingo_blue", FRIEND, "FriendMC", 7]] }]);
    const res = await importFile(path);
    expect(await res.json()).toEqual({ found: 1, imported: 1, replaced: 0, skipped: 0, partial: 0 });

    const m = await (await app.request(`/api/matches/${G1}`)).json();
    expect(m).toMatchObject({ source: "yab-stats", partial: false, durationMs: 2_400_000, boards: [], events: [], uploader: "Dyrox" });
    expect(m.teams.map((t: any) => [t.id, t.items, t.winner, t.players[0].name])).toEqual([["bingo_red", 12, true, "Dyrox2333"], ["bingo_blue", 7, false, "FriendMC"]]);
    expect(m.options).toMatchObject({ winCondition: "cards:1", endWhen: "first_win", stalemate: "end_game", goal: "lines:3", mode: "lockout", timeLimitSeconds: 2700, nightVision: true, pvp: false });
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
    expect(await (await importFile(mine)).json()).toEqual({ found: 2, imported: 1, replaced: 0, skipped: 1, partial: 1 });
    expect(await (await importFile(mine)).json()).toEqual({ found: 2, imported: 0, replaced: 0, skipped: 2, partial: 0 });
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
