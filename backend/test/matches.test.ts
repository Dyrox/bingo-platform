import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDb, type DB } from "../src/db/client.ts";
import { createKey } from "../src/keys.ts";
import { uploadKeys } from "../src/db/schema.ts";

const sample = () => JSON.parse(readFileSync(new URL("../examples/match.json", import.meta.url), "utf8"));

let db: DB, app: ReturnType<typeof createApp>, key: string;
beforeEach(async () => {
  db = await openDb({ pgliteDir: "memory://" });
  app = createApp(db);
  key = (await createKey(db, "dyrox", "MacBook Air")).key;
});

const upload = (body: unknown, k: string | null = key) => app.request("/api/matches", {
  method: "POST",
  headers: { "content-type": "application/json", ...(k ? { authorization: `Bearer ${k}` } : {}) },
  body: JSON.stringify(body),
});

describe("POST /api/matches", () => {
  it("stores a match and returns it from the detail endpoint unchanged", async () => {
    const m = sample();
    const res = await upload(m);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: m.id, created: true });

    const got = await (await app.request(`/api/matches/${m.id}`)).json();
    expect(got.uploader).toBe("dyrox");
    expect(got.options).toEqual(m.options);
    expect(got.teams).toEqual(m.teams);
    expect(got.boards[0].seed).toBe(m.boards[0].seed);
    expect(got.boards[0].cells).toEqual([...m.boards[0].cells].sort((a, b) => a.y - b.y || a.x - b.x));
  });

  it("replaces a round when the same uploader sends it again (resumed rounds)", async () => {
    expect((await upload(sample())).status).toBe(201);
    const resumed = sample();
    resumed.teams[0].items = 20;
    resumed.durationMs += 60_000;
    const again = await upload(resumed);
    expect(again.status).toBe(200);
    expect((await again.json()).created).toBe(false);
    expect((await (await app.request("/api/matches")).json()).matches).toHaveLength(1);
    const got = await (await app.request(`/api/matches/${resumed.id}`)).json();
    expect(got.teams[0].items).toBe(20);
    expect(got.durationMs).toBe(resumed.durationMs);
    expect(got.boards[0].cells).toHaveLength(25);
  });

  it("a first-win round that ended on a team's line was won by that team, even if the reporter didn't say", async () => {
    const m = sample();
    m.options = { winCondition: "cards:1", endWhen: "first_win" };
    m.teams = m.teams.map((t: any) => ({ ...t, winner: false }));
    m.events = [
      { t: 1000, type: "line", team: "blue", value: 1 },
      { t: m.durationMs, type: "line", team: "red", value: 8 },
    ];
    await upload(m);
    const winners = async () => (await (await app.request(`/api/matches/${m.id}`)).json()).teams.map((t: any) => [t.id, t.winner]);
    expect(await winners()).toEqual([["red", true], ["blue", false]]);

    // stopped by hand a minute after the last line: nobody won
    m.durationMs += 60_000;
    await upload(m);
    expect(await winners()).toEqual([["red", false], ["blue", false]]);
  });

  it("won't let another user overwrite a round", async () => {
    await upload(sample());
    const other = (await createKey(db, "someone-else", "PC")).key;
    expect((await upload(sample(), other)).status).toBe(409);
  });

  it("rejects missing, wrong and revoked keys", async () => {
    expect((await upload(sample(), null)).status).toBe(401);
    expect((await upload(sample(), "bgr_nope")).status).toBe(401);
    await db.update(uploadKeys).set({ revokedAt: new Date() });
    expect((await upload(sample())).status).toBe(401);
  });

  it("rejects payloads that reference unknown teams or repeat cells", async () => {
    const m = sample();
    m.boards[0].cells[0].completedBy = ["green"];
    m.boards[0].cells[1].x = m.boards[0].cells[2].x;
    m.boards[0].cells[1].y = m.boards[0].cells[2].y;
    const res = await upload(m);
    expect(res.status).toBe(400);
    const msgs = (await res.json()).issues.map((i: any) => i.message);
    expect(msgs).toContain('unknown team "green"');
    expect(msgs).toContain("duplicate cell position");
  });

  it("returns 409 when a board id is reused by a different match", async () => {
    await upload(sample());
    const m = sample();
    m.id = "11111111-2222-4333-8444-555555555555";
    expect((await upload(m)).status).toBe(409);
  });
});

describe("GET /api/matches", () => {
  const withId = (id: string, endedAt: string, boardId: string) => {
    const m = sample();
    Object.assign(m, { id, endedAt, startedAt: "2026-10-01T00:00:00Z" });
    m.boards[0].id = boardId;
    return m;
  };

  it("lists newest first, filters by player and pages with `before`", async () => {
    await upload(withId("aaaaaaaa-0000-4000-8000-000000000001", "2026-10-01T10:00:00Z", "bbbbbbbb-0000-4000-8000-000000000001"));
    await upload(withId("aaaaaaaa-0000-4000-8000-000000000002", "2026-10-02T10:00:00Z", "bbbbbbbb-0000-4000-8000-000000000002"));
    const solo = withId("aaaaaaaa-0000-4000-8000-000000000003", "2026-10-03T10:00:00Z", "bbbbbbbb-0000-4000-8000-000000000003");
    solo.teams = [{ ...solo.teams[0], winner: true }];
    solo.boards[0].teams = ["red"];
    solo.boards[0].cells.forEach((c: any) => { c.completedBy = c.completedBy.filter((t: string) => t === "red"); });
    await upload(solo);

    const all = await (await app.request("/api/matches")).json();
    expect(all.matches.map((m: any) => m.id.at(-1))).toEqual(["3", "2", "1"]);
    expect(all.matches[0].teams[0].players[0].name).toBe("dyrox");

    const friend = await (await app.request("/api/matches?player=8a4b6c2d-1e3f-4a5b-8c7d-9e0f1a2b3c4d")).json();
    expect(friend.matches.map((m: any) => m.id.at(-1))).toEqual(["2", "1"]);

    const p1 = await (await app.request("/api/matches?limit=2")).json();
    expect(p1.matches).toHaveLength(2);
    const p2 = await (await app.request(`/api/matches?limit=2&before=${encodeURIComponent(p1.next)}`)).json();
    expect(p2.matches.map((m: any) => m.id.at(-1))).toEqual(["1"]);
    expect(p2.next).toBeNull();
  });

  it("404s an unknown match and 400s a malformed id", async () => {
    expect((await app.request("/api/matches/99999999-9999-4999-8999-999999999999")).status).toBe(404);
    expect((await app.request("/api/matches/not-a-uuid")).status).toBe(400);
  });
});

describe("players", () => {
  const dyrox = "0f3c2d9e-7a51-4b8e-9c33-1d2e4f5a6b70";
  const friend = "8a4b6c2d-1e3f-4a5b-8c7d-9e0f1a2b3c4d";
  // n-th round; `redWins` decides the winner, null = nobody won
  const round = (n: number, redWins: boolean | null, endedAt: string) => {
    const m = sample();
    m.id = `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
    m.boards[0].id = `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
    Object.assign(m, { startedAt: "2026-01-01T00:00:00Z", endedAt, durationMs: 60_000 * n });
    m.teams[0].winner = redWins === true;
    m.teams[1].winner = redWins === false;
    m.teams[0].items = n;
    return m;
  };

  it("lists players with game counts, most recent first", async () => {
    await upload(round(1, true, "2026-10-01T10:00:00Z"));
    const solo = round(2, true, "2026-10-02T10:00:00Z");
    solo.teams = [{ ...solo.teams[1], winner: false }];
    solo.boards[0].teams = ["blue"];
    solo.boards[0].cells.forEach((c: any) => { c.completedBy = c.completedBy.filter((t: string) => t === "blue"); });
    await upload(solo);
    const { players } = await (await app.request("/api/players")).json();
    expect(players.map((p: any) => [p.name, p.games])).toEqual([["FriendMC", 2], ["dyrox", 1]]);
  });

  it("computes wins, losses, draws, streaks and monthly totals", async () => {
    // dyrox is red: win, win, draw, loss, win, win
    const results = [true, true, null, false, true, true];
    for (const [i, r] of results.entries()) await upload(round(i + 1, r, `2026-10-${String(10 + i).padStart(2, "0")}T10:00:00Z`));
    const p = await (await app.request(`/api/players/${dyrox}`)).json();
    expect(p.name).toBe("dyrox");
    expect(p.allTime).toMatchObject({ games: 6, wins: 4, losses: 1, draws: 1, items: 21, bestItems: 6, winStreak: 2, bestWinStreak: 2, playtimeMs: 21 * 60_000 });
    expect(p.history.map((h: any) => h.result)).toEqual(["win", "win", "draw", "loss", "win", "win"]);
    expect(p.favoriteTeam).toEqual({ teamId: "red", share: 1 });

    const f = await (await app.request(`/api/players/${friend}`)).json();
    expect(f.allTime).toMatchObject({ wins: 1, losses: 4, draws: 1, winStreak: 0 });
  });

  it("404s an unknown player", async () => {
    expect((await app.request("/api/players/99999999-9999-4999-8999-999999999999")).status).toBe(404);
  });
});

describe("timeline events", () => {
  it("stores events in time order and returns them with the match", async () => {
    const m = sample();
    m.events = [
      { t: 455_000, type: "line", team: "red", value: 1 },
      { t: 5_000, type: "goal", team: "red", player: "0f3c2d9e-7a51-4b8e-9c33-1d2e4f5a6b70", objectiveId: "minecraft:stick" },
      { t: 60_000, type: "lost", team: "blue", objectiveId: "minecraft:dirt" },
    ];
    expect((await upload(m)).status).toBe(201);
    const got = await (await app.request(`/api/matches/${m.id}`)).json();
    expect(got.events.map((e: any) => [e.t, e.type, e.team, e.player, e.objectiveId, e.value])).toEqual([
      [5_000, "goal", "red", "0f3c2d9e-7a51-4b8e-9c33-1d2e4f5a6b70", "minecraft:stick", null],
      [60_000, "lost", "blue", null, "minecraft:dirt", null],
      [455_000, "line", "red", null, null, 1],
    ]);
  });

  it("returns no events for rounds uploaded without them, and rejects unknown teams", async () => {
    await upload(sample());
    expect((await (await app.request(`/api/matches/${sample().id}`)).json()).events).toEqual([]);
    const bad = sample();
    bad.id = "22222222-2222-4222-8222-222222222222";
    bad.boards[0].id = "33333333-3333-4333-8333-333333333333";
    bad.events = [{ t: 1, type: "goal", team: "green" }];
    expect((await upload(bad)).status).toBe(400);
  });
});

describe("serving the site", () => {
  it("serves files, falls back to the app shell for site routes, and keeps /api as JSON", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dist = mkdtempSync(join(tmpdir(), "web-dist-"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><div id=root></div>");
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "assets", "app-abc123.js"), "console.log(1)");
    const site = createApp(db, { webDist: dist });

    const asset = await site.request("/assets/app-abc123.js");
    expect(await asset.text()).toBe("console.log(1)");
    expect(asset.headers.get("cache-control")).toContain("immutable");

    const route = await site.request("/players/0f3c2d9e-7a51-4b8e-9c33-1d2e4f5a6b70/records");
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("<div id=root>");

    const api = await site.request("/api/nope");
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: "not_found" });
    expect((await site.request("/api/health")).status).toBe(200);
  });
});
