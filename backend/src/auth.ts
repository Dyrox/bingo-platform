import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, eq, gt, isNull, ne, or } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { DB } from "./db/client.ts";
import { linkCodes, matches, players, sessions, uploadKeys, users } from "./db/schema.ts";
import { createKeyForUser, findKey } from "./keys.ts";
import { importYabGames, readYabStats } from "./import-yab.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface AuthConfig {
  discordClientId?: string;
  discordClientSecret?: string;
  /** Where the site is reached, e.g. http://localhost:5173. Discord redirects back to <publicUrl>/api/auth/discord/callback. */
  publicUrl: string;
  /** Swappable for tests; talks to discord.com otherwise. */
  fetch?: typeof fetch;
  /** Discord user ids that may manage (delete, exclude) any match, not just their own uploads. */
  adminDiscordIds?: string[];
}

export const authConfigFromEnv = (): AuthConfig => ({
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET,
  publicUrl: (process.env.PUBLIC_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  adminDiscordIds: (process.env.ADMIN_DISCORD_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean),
});

const SESSION_COOKIE = "bingo_session";
const STATE_COOKIE = "bingo_oauth_state";
const SESSION_DAYS = 30;
const LINK_CODE_MINUTES = 10;
// no 0/O, 1/I/L: the code is read off a screen and typed into chat
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The logged-in user for this request, or null. */
export async function currentUser(db: DB, c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const [row] = await db.select({ user: users }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
  return row?.user ?? null;
}

/** Discord's display name, made unique among our users (names are shown on matches as uploader). */
async function freeName(db: DB, wanted: string, discordId: string) {
  for (let n = 1; ; n++) {
    const name = n === 1 ? wanted : `${wanted}#${n}`;
    const [taken] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.name, name), or(isNull(users.discordId), ne(users.discordId, discordId))));
    if (!taken) return name;
  }
}

export function registerAuthRoutes(app: Hono<any>, db: DB, cfg: AuthConfig) {
  const http = cfg.fetch ?? fetch;
  const configured = !!(cfg.discordClientId && cfg.discordClientSecret);
  const redirectUri = `${cfg.publicUrl}/api/auth/discord/callback`;
  const secure = cfg.publicUrl.startsWith("https://");

  app.get("/api/auth/discord", c => {
    if (!configured) return c.json({ error: "discord_not_configured" }, 503);
    const state = randomBytes(16).toString("base64url");
    setCookie(c, STATE_COOKIE, state, { httpOnly: true, sameSite: "Lax", secure, path: "/api/auth", maxAge: 600 });
    const q = new URLSearchParams({ client_id: cfg.discordClientId!, response_type: "code", redirect_uri: redirectUri, scope: "identify", state, prompt: "none" });
    return c.redirect(`https://discord.com/oauth2/authorize?${q}`);
  });

  app.get("/api/auth/discord/callback", async c => {
    const { code, state } = c.req.query();
    const expected = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/api/auth" });
    // user pressed "cancel" on Discord, or the link was replayed / forged
    if (!code || !state || state !== expected) return c.redirect(`${cfg.publicUrl}/account?login=failed`);

    const tokenRes = await http("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.discordClientId!, client_secret: cfg.discordClientSecret!,
        grant_type: "authorization_code", code, redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) return c.redirect(`${cfg.publicUrl}/account?login=failed`);
    const { access_token } = await tokenRes.json() as { access_token: string };
    const meRes = await http("https://discord.com/api/users/@me", { headers: { authorization: `Bearer ${access_token}` } });
    if (!meRes.ok) return c.redirect(`${cfg.publicUrl}/account?login=failed`);
    const me = await meRes.json() as { id: string; username: string; global_name?: string | null; avatar?: string | null };

    const avatarUrl = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null;
    let [user] = await db.select().from(users).where(eq(users.discordId, me.id));
    if (user) {
      [user] = await db.update(users).set({ avatarUrl }).where(eq(users.id, user.id)).returning();
    } else {
      const name = await freeName(db, me.global_name || me.username, me.id);
      [user] = await db.insert(users).values({ name, discordId: me.id, avatarUrl }).returning();
    }

    const token = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({ tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400e3) });
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: "Lax", secure, path: "/", maxAge: SESSION_DAYS * 86400 });
    return c.redirect(`${cfg.publicUrl}/account`);
  });

  app.post("/api/auth/logout", async c => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  /** Logged out: { user: null }. Logged in: the account, its Minecraft players and upload keys. */
  app.get("/api/me", async c => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ user: null, discord: configured });
    const [mine, keys] = await Promise.all([
      db.select({ uuid: players.uuid, name: players.name }).from(players).where(eq(players.userId, user.id)).orderBy(players.name),
      db.select({ id: uploadKeys.id, name: uploadKeys.name, prefix: uploadKeys.prefix, createdAt: uploadKeys.createdAt, lastUsedAt: uploadKeys.lastUsedAt })
        .from(uploadKeys).where(and(eq(uploadKeys.userId, user.id), isNull(uploadKeys.revokedAt))).orderBy(uploadKeys.createdAt),
    ]);
    return c.json({ user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl }, players: mine, keys, discord: configured });
  });

  // everything below needs a logged-in user
  const withUser = async (c: Context, fn: (user: typeof users.$inferSelect) => Promise<Response>) => {
    const user = await currentUser(db, c);
    return user ? fn(user) : c.json({ error: "not_logged_in" }, 401);
  };

  app.post("/api/me/link-code", c => withUser(c, async user => {
    await db.delete(linkCodes).where(and(eq(linkCodes.userId, user.id), isNull(linkCodes.usedBy)));
    const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    const expiresAt = new Date(Date.now() + LINK_CODE_MINUTES * 60e3);
    await db.insert(linkCodes).values({ code, userId: user.id, expiresAt });
    return c.json({ code, expiresAt: expiresAt.toISOString() });
  }));

  app.delete("/api/me/players/:uuid", c => withUser(c, async user => {
    await db.update(players).set({ userId: null }).where(and(eq(players.uuid, c.req.param("uuid")), eq(players.userId, user.id)));
    return c.json({ ok: true });
  }));

  app.post("/api/me/keys", c => withUser(c, async user => {
    const body = z.object({ name: z.string().trim().min(1).max(40) }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    const { key, keyId } = await createKeyForUser(db, user.id, body.data.name);
    return c.json({ key, id: keyId }, 201);
  }));

  app.delete("/api/me/keys/:id", c => withUser(c, async user => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "not_found" }, 404);
    await db.update(uploadKeys).set({ revokedAt: new Date() }).where(and(eq(uploadKeys.id, id.data), eq(uploadKeys.userId, user.id)));
    return c.json({ ok: true });
  }));

  // Managing a match: whoever uploaded (or imported) it, and admins.
  const admins = new Set(cfg.adminDiscordIds ?? []);
  const manageable = async (c: Context) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return { error: c.json({ error: "not_found" }, 404) };
    const user = await currentUser(db, c);
    if (!user) return { error: c.json({ error: "not_logged_in" }, 401) };
    const [m] = await db.select({ uploaderId: matches.uploaderId }).from(matches).where(eq(matches.id, id.data));
    if (!m) return { error: c.json({ error: "not_found" }, 404) };
    if (m.uploaderId !== user.id && !(user.discordId && admins.has(user.discordId))) return { error: c.json({ error: "forbidden" }, 403) };
    return { id: id.data };
  };

  app.get("/api/matches/:id/access", async c => {
    const r = await manageable(c);
    return c.json({ canManage: !("error" in r) });
  });

  // "doesn't count": keep the round visible but out of every statistic
  app.patch("/api/matches/:id", async c => {
    const r = await manageable(c);
    if ("error" in r) return r.error!;
    const body = z.object({ excluded: z.boolean() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    await db.update(matches).set({ excluded: body.data.excluded }).where(eq(matches.id, r.id));
    return c.json({ ok: true, excluded: body.data.excluded });
  });

  // teams, players, cards and timeline go with it (ON DELETE CASCADE)
  app.delete("/api/matches/:id", async c => {
    const r = await manageable(c);
    if ("error" in r) return r.error!;
    await db.delete(matches).where(eq(matches.id, r.id));
    return c.json({ ok: true });
  });

  /**
   * Import YAB's own history: the bingo.db file from config/yet-another-minecraft-bingo/, sent as the
   * "file" field of a multipart form. Results only (no cards); see import-yab.ts for the rules.
   */
  app.post("/api/me/import/yab", c => withUser(c, async user => {
    const body = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "no_file" }, 400);
    if (file.size > 50 * 1024 * 1024) return c.json({ error: "file_too_large" }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 15)) !== "SQLite format 3") return c.json({ error: "not_sqlite" }, 400);

    const dir = mkdtempSync(join(tmpdir(), "yab-import-"));
    try {
      const path = join(dir, "bingo.db");
      writeFileSync(path, bytes);
      let games;
      try { games = readYabStats(path); } catch (e) { return c.json({ error: "not_yab", message: (e as Error).message }, 400); }
      return c.json(await importYabGames(db, user.id, games));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }));

  /**
   * Called by bingo-reporter when a player types "/bingo link <code>": the game server vouches for
   * which Minecraft account typed it, the code says which website account asked for it.
   */
  app.post("/api/link", async c => {
    const token = c.req.header("authorization")?.match(/^Bearer (\S+)$/)?.[1];
    if (!token || !await findKey(db, token)) return c.json({ error: "invalid_key" }, 401);
    const body = z.object({ code: z.string().trim().toUpperCase(), uuid: z.uuid(), name: z.string().min(1).max(16) })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_request", issues: body.error.issues }, 400);
    const { code, uuid, name } = body.data;

    const [row] = await db.select({ code: linkCodes, user: users }).from(linkCodes)
      .innerJoin(users, eq(users.id, linkCodes.userId))
      .where(and(eq(linkCodes.code, code), isNull(linkCodes.usedBy), gt(linkCodes.expiresAt, new Date())));
    if (!row) return c.json({ error: "invalid_code" }, 404);

    await db.transaction(async tx => {
      await tx.insert(players).values({ uuid, name, userId: row.user.id })
        .onConflictDoUpdate({ target: players.uuid, set: { name, userId: row.user.id } });
      await tx.update(linkCodes).set({ usedBy: uuid }).where(eq(linkCodes.code, code));
    });
    return c.json({ ok: true, user: row.user.name });
  });
}
