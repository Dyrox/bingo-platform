import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDb, type DB } from "../src/db/client.ts";
import { createKey } from "../src/keys.ts";

const sample = () => JSON.parse(readFileSync(new URL("../examples/match.json", import.meta.url), "utf8"));
const DYROX = "0f3c2d9e-7a51-4b8e-9c33-1d2e4f5a6b70";    // red in the sample
const FRIEND = "8a4b6c2d-1e3f-4a5b-8c7d-9e0f1a2b3c4d";   // blue in the sample
const THIRD = "33333333-3333-4333-8333-333333333333";

let db: DB, app: ReturnType<typeof createApp>, key: string;
beforeEach(async () => {
  db = await openDb({ pgliteDir: "memory://" });
  app = createApp(db);
  key = (await createKey(db, "dyrox", "test")).key;
});

const upload = async (m: unknown) => {
  const res = await app.request("/api/matches", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(m),
  });
  expect(res.status).toBeLessThan(300);
};
const json = async (path: string) => (await app.request(path)).json();

/** n-th round on `day` (ISO date); red wins if redWins, blue if false, nobody if null. */
function round(n: number, day: string, redWins: boolean | null) {
  const m = sample();
  m.id = `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
  m.boards[0].id = `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
  Object.assign(m, { startedAt: `${day}T09:00:00Z`, endedAt: `${day}T10:00:00Z` });
  m.teams[0].winner = redWins === true;
  m.teams[1].winner = redWins === false;
  return m;
}

describe("leaderboard", () => {
  it("ranks by wins and reports the fastest first line and card from timelines", async () => {
    const a = round(1, "2026-09-01", true);
    a.events = [
      { t: 300_000, type: "line", team: "red", value: 1 },
      { t: 900_000, type: "line", team: "red", value: 2 },
      { t: 450_000, type: "line", team: "blue", value: 1 },
    ];
    const b = round(2, "2026-10-01", true);
    b.events = [{ t: 240_000, type: "line", team: "red", value: 1 }, { t: 1_200_000, type: "card", team: "red", value: 1 }];
    await upload(a);
    await upload(b);
    await upload(round(3, "2026-10-02", false));

    const { players } = await json("/api/leaderboard");
    expect(players.map((p: any) => [p.name, p.wins, p.losses])).toEqual([["dyrox", 2, 1], ["FriendMC", 1, 2]]);
    const dyrox = players[0];
    expect(dyrox.winRate).toBeCloseTo(2 / 3);
    expect(dyrox.fastestLineMs).toBe(240_000); // the second round's line, not the first round's 300 000
    expect(dyrox.fastestCardMs).toBe(1_200_000);
    expect(players[1].fastestLineMs).toBe(450_000);
    expect(players[1].fastestCardMs).toBeNull();
  });

  it("can be limited to this month", async () => {
    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    await upload(round(1, "2020-01-01", true));
    await upload(round(2, thisMonth, false));
    const { players } = await json("/api/leaderboard?period=month");
    expect(players.map((p: any) => [p.name, p.games, p.wins])).toEqual([["FriendMC", 1, 1], ["dyrox", 1, 0]]);
    expect((await app.request("/api/leaderboard?period=year")).status).toBe(400);
  });
});

describe("rivals", () => {
  it("lists opponents with the player's record against them, ignoring teammates", async () => {
    await upload(round(1, "2026-10-01", true));
    await upload(round(2, "2026-10-02", true));
    await upload(round(3, "2026-10-03", null));
    // a third player joins dyrox's team: a teammate, not a rival
    const withMate = round(4, "2026-10-04", false);
    withMate.teams[0].players.push({ uuid: THIRD, name: "Mate" });
    await upload(withMate);

    const p = await json(`/api/players/${DYROX}`);
    expect(p.rivals).toEqual([{ uuid: FRIEND, name: "FriendMC", games: 4, wins: 2, losses: 1, draws: 1 }]);
    const mate = await json(`/api/players/${THIRD}`);
    expect(mate.rivals.map((r: any) => [r.name, r.games, r.losses])).toEqual([["FriendMC", 1, 1]]);
  });
});

describe("goal stats", () => {
  it("counts appearances per team card, completions and time to complete", async () => {
    const a = round(1, "2026-10-01", true);
    const goal = a.boards[0].cells[0].objectiveId;
    a.boards[0].cells[0].completedBy = ["red"];
    a.events = [{ t: 60_000, type: "goal", team: "red", player: DYROX, objectiveId: goal }];
    const b = round(2, "2026-10-02", true);
    b.boards[0].cells[0].completedBy = ["red", "blue"];
    b.events = [
      { t: 120_000, type: "goal", team: "red", player: DYROX, objectiveId: goal },
      { t: 30_000, type: "goal", team: "blue", player: FRIEND, objectiveId: goal },
      { t: 50_000, type: "lost", team: "blue", objectiveId: goal },
      { t: 90_000, type: "goal", team: "blue", player: FRIEND, objectiveId: goal }, // regained: the first time counts
    ];
    await upload(a);
    await upload(b);

    const { goals } = await json("/api/goals/stats");
    // 2 rounds × 2 teams sharing the card
    expect(goals[goal]).toEqual({ appearances: 4, completions: 3, avgMs: 70_000, fastestMs: 30_000 });

    const p = await json(`/api/players/${DYROX}`);
    expect(p.goals.best[0]).toEqual({ objectiveId: goal, appearances: 2, completions: 2, avgMs: 90_000, fastestMs: 60_000 });
    // goals dyrox's team never completed in these rounds
    expect(p.goals.worst.length).toBeGreaterThan(0);
    expect(p.goals.worst.every((g: any) => g.appearances > g.completions)).toBe(true);
  });
});
