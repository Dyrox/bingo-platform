import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDb, type DB } from "../src/db/client.ts";
import { boards, matchEvents, sessions, users } from "../src/db/schema.ts";
import { createKey } from "../src/keys.ts";

const DYROX = "0f3c2d9e-7a51-4b8e-9c33-1d2e4f5a6b70";
const sample = () => JSON.parse(readFileSync(new URL("../examples/match.json", import.meta.url), "utf8"));

let db: DB, app: ReturnType<typeof createApp>, matchId: string;
const cookies: Record<string, string> = {};

/** A logged-in user; `discordId` makes them an admin when it's in the admin list. */
async function session(name: string, discordId: string, userId?: string) {
  const id = userId ?? (await db.insert(users).values({ name, discordId }).returning())[0].id;
  if (userId) await db.update(users).set({ discordId }).where(eq(users.id, userId));
  await db.insert(sessions).values({ tokenHash: createHash("sha256").update(name).digest("hex"), userId: id, expiresAt: new Date(Date.now() + 86400e3) });
  cookies[name] = `bingo_session=${name}`;
}

beforeEach(async () => {
  db = await openDb({ pgliteDir: "memory://" });
  app = createApp(db, { auth: { publicUrl: "http://site.test", adminDiscordIds: ["admin-discord"] } });
  const { key, userId } = await createKey(db, "uploader", "pc");
  const m = sample();
  m.events = [{ t: 1000, type: "line", team: "red", value: 1 }];
  matchId = m.id;
  const res = await app.request("/api/matches", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(m) });
  expect(res.status).toBe(201);
  await session("uploader", "uploader-discord", userId);
  await session("stranger", "stranger-discord");
  await session("admin", "admin-discord");
});

const call = (method: string, who: string | null, body?: unknown) => app.request(`/api/matches/${matchId}`, {
  method, headers: { ...(who ? { cookie: cookies[who] } : {}), ...(body ? { "content-type": "application/json" } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const json = async (path: string) => (await app.request(path)).json();

describe("managing a match", () => {
  it("lets the uploader and admins manage it, nobody else", async () => {
    const access = async (who: string | null) => (await (await app.request(`/api/matches/${matchId}/access`, { headers: who ? { cookie: cookies[who] } : {} })).json()).canManage;
    expect([await access("uploader"), await access("admin"), await access("stranger"), await access(null)]).toEqual([true, true, false, false]);
    expect((await call("PATCH", "stranger", { excluded: true })).status).toBe(403);
    expect((await call("DELETE", "stranger")).status).toBe(403);
    expect((await call("DELETE", null)).status).toBe(401);
    expect((await call("PATCH", "uploader", { excluded: "yes" })).status).toBe(400);
  });

  it("an excluded round stays visible but leaves every statistic, and can be counted again", async () => {
    const before = await json(`/api/players/${DYROX}`);
    expect(before.allTime.games).toBe(1);

    expect((await call("PATCH", "admin", { excluded: true })).status).toBe(200);
    expect((await json(`/api/matches/${matchId}`)).excluded).toBe(true);
    expect((await json("/api/matches")).matches.map((m: any) => [m.id, m.excluded])).toEqual([[matchId, true]]);
    const p = await json(`/api/players/${DYROX}`);
    expect(p.allTime.games).toBe(0);
    expect(p.history).toEqual([]);
    expect(p.rivals).toEqual([]);
    expect((await json("/api/leaderboard")).players).toEqual([]);
    expect((await json("/api/goals/stats")).goals).toEqual({});
    expect((await json("/api/players")).players).toEqual([]);

    await call("PATCH", "uploader", { excluded: false });
    expect((await json(`/api/players/${DYROX}`)).allTime).toEqual(before.allTime);
  });

  it("deleting removes the round with its card and timeline", async () => {
    expect((await call("DELETE", "uploader")).status).toBe(200);
    expect((await app.request(`/api/matches/${matchId}`)).status).toBe(404);
    expect(await db.select().from(boards)).toEqual([]);
    expect(await db.select().from(matchEvents)).toEqual([]);
    expect((await call("DELETE", "uploader")).status).toBe(404);
  });
});
