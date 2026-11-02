import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDb, type DB } from "../src/db/client.ts";
import { createKey } from "../src/keys.ts";

// A stand-in for discord.com: one known authorization code, one Discord user.
const fakeDiscord: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/oauth2/token")) {
    const body = new URLSearchParams(String(init?.body));
    return body.get("code") === "good-code"
      ? Response.json({ access_token: "tok" })
      : new Response("bad code", { status: 400 });
  }
  if (url.endsWith("/users/@me")) return Response.json({ id: "1234", username: "dyrox", global_name: "Dyrox", avatar: "abc" });
  throw new Error(`unexpected fetch ${url}`);
};

let db: DB, app: ReturnType<typeof createApp>, reporterKey: string;
beforeEach(async () => {
  db = await openDb({ pgliteDir: "memory://" });
  app = createApp(db, { auth: { discordClientId: "cid", discordClientSecret: "secret", publicUrl: "http://site.test", fetch: fakeDiscord } });
  reporterKey = (await createKey(db, "server-owner", "LAN host")).key;
});

const cookiesOf = (res: Response) => Object.fromEntries(res.headers.getSetCookie().map(c => c.split(";")[0].split("=") as [string, string]));

/** Runs the Discord login round trip and returns the session cookie header. */
async function login() {
  const start = await app.request("/api/auth/discord");
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const back = await app.request(`/api/auth/discord/callback?code=good-code&state=${state}`, {
    headers: { cookie: `bingo_oauth_state=${cookiesOf(start).bingo_oauth_state}` },
  });
  expect(back.headers.get("location")).toBe("http://site.test/account");
  return `bingo_session=${cookiesOf(back).bingo_session}`;
}

const me = async (cookie?: string) => (await app.request("/api/me", { headers: cookie ? { cookie } : {} })).json();

describe("Discord login", () => {
  it("logs in, shows the account, logs out", async () => {
    expect(await me()).toEqual({ user: null, discord: true });
    const cookie = await login();
    const m = await me(cookie);
    expect(m.user).toMatchObject({ name: "Dyrox", avatarUrl: "https://cdn.discordapp.com/avatars/1234/abc.png?size=64" });
    expect(m.players).toEqual([]);

    // logging in again reuses the account
    const again = await login();
    expect((await me(again)).user.id).toBe(m.user.id);

    await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect((await me(cookie)).user).toBeNull();
  });

  it("rejects a callback whose state doesn't match the cookie", async () => {
    const res = await app.request("/api/auth/discord/callback?code=good-code&state=forged", { headers: { cookie: "bingo_oauth_state=real" } });
    expect(res.headers.get("location")).toBe("http://site.test/account?login=failed");
    expect(res.headers.getSetCookie().some(c => c.startsWith("bingo_session="))).toBe(false);
  });

  it("says when Discord isn't configured", async () => {
    const bare = createApp(db);
    expect((await bare.request("/api/auth/discord")).status).toBe(503);
    expect(await (await bare.request("/api/me")).json()).toEqual({ user: null, discord: false });
  });

  it("gives a clashing name a number instead of failing", async () => {
    await createKey(db, "Dyrox", "old script user");
    const cookie = await login();
    expect((await me(cookie)).user.name).toBe("Dyrox#2");
  });
});

describe("/bingo link", () => {
  const link = (body: object, key = reporterKey) => app.request("/api/link", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body),
  });

  it("links the Minecraft account that typed the code to the account that asked for it", async () => {
    const cookie = await login();
    const { code } = await (await app.request("/api/me/link-code", { method: "POST", headers: { cookie } })).json();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    const res = await link({ code: code.toLowerCase(), uuid: "0537939b-26c6-4746-a45b-2e7aaebe0963", name: "Dyrox2333" });
    expect(await res.json()).toEqual({ ok: true, user: "Dyrox" });
    expect((await me(cookie)).players).toEqual([{ uuid: "0537939b-26c6-4746-a45b-2e7aaebe0963", name: "Dyrox2333" }]);

    // a code works once
    expect((await link({ code, uuid: "8a4b6c2d-1e3f-4a5b-8c7d-9e0f1a2b3c4d", name: "FriendMC" })).status).toBe(404);

    // and can be undone from the website
    await app.request("/api/me/players/0537939b-26c6-4746-a45b-2e7aaebe0963", { method: "DELETE", headers: { cookie } });
    expect((await me(cookie)).players).toEqual([]);
  });

  it("works for a brand-new Minecraft account that has never played a round", async () => {
    const cookie = await login();
    const { code } = await (await app.request("/api/me/link-code", { method: "POST", headers: { cookie } })).json();
    const fresh = "11111111-2222-4333-8444-555555555555";
    expect((await link({ code, uuid: fresh, name: "NewPlayer" })).status).toBe(200);
    expect((await me(cookie)).players).toEqual([{ uuid: fresh, name: "NewPlayer" }]);

    // their page opens with empty stats rather than "not found"
    const res = await app.request(`/api/players/${fresh}`);
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(p).toMatchObject({ name: "NewPlayer", lastPlayed: null, favoriteTeam: null, history: [] });
    expect(p.allTime).toMatchObject({ games: 0, wins: 0, items: 0, winStreak: 0 });
  });

  it("refuses unknown codes, bad keys and logged-out code requests", async () => {
    expect((await link({ code: "ZZZZZZ", uuid: "0537939b-26c6-4746-a45b-2e7aaebe0963", name: "x" })).status).toBe(404);
    expect((await link({ code: "ZZZZZZ", uuid: "0537939b-26c6-4746-a45b-2e7aaebe0963", name: "x" }, "bgr_nope")).status).toBe(401);
    expect((await app.request("/api/me/link-code", { method: "POST" })).status).toBe(401);
  });
});

describe("upload keys on the website", () => {
  it("creates, lists and revokes keys", async () => {
    const cookie = await login();
    const created = await app.request("/api/me/keys", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "MacBook Air" }),
    });
    expect(created.status).toBe(201);
    const { key, id } = await created.json();
    expect(key).toMatch(/^bgr_/);
    const keys = (await me(cookie)).keys;
    expect(keys.map((k: any) => [k.name, k.prefix])).toEqual([["MacBook Air", key.slice(0, 8)]]);

    // the key works for the reporter until it's revoked
    const linkWith = () => app.request("/api/link", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: "{}" });
    expect((await linkWith()).status).toBe(400);
    await app.request(`/api/me/keys/${id}`, { method: "DELETE", headers: { cookie } });
    expect((await linkWith()).status).toBe(401);
    expect((await me(cookie)).keys).toEqual([]);
  });
});
