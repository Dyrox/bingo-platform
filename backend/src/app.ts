import { Hono, type Context } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { DB } from "./db/client.ts";
import { eq } from "drizzle-orm";
import { users } from "./db/schema.ts";
import { findKey } from "./keys.ts";
import { ConflictError, getMatch, listMatches, saveMatch } from "./matches.ts";
import { MatchUpload } from "./payload.ts";
import { leaderboard, listPlayers, playerProfile } from "./players.ts";
import { goalStats } from "./stats.ts";
import { registerAuthRoutes, type AuthConfig } from "./auth.ts";

type Env = { Variables: { key: NonNullable<Awaited<ReturnType<typeof findKey>>> } };

const invalid = (result: { success: true } | { success: false; error: { issues: unknown[] } }, c: Context) => {
  if (!result.success) return c.json({ error: "invalid_request", issues: result.error.issues }, 400);
};

/** webDist: the built site (web/dist); when set, everything outside /api is served from it. */
export function createApp(db: DB, opts: { auth?: AuthConfig; webDist?: string } = {}) {
  const app = new Hono<Env>();
  registerAuthRoutes(app, db, opts.auth ?? { publicUrl: "http://localhost:5173" });

  app.get("/api/health", c => c.json({ ok: true }));

  // bingo-reporter asks this when the game starts: is the upload key still good, and whose is it?
  app.get("/api/key", async c => {
    const token = c.req.header("authorization")?.match(/^Bearer (\S+)$/)?.[1];
    const key = token && await findKey(db, token);
    if (!key) return c.json({ error: "invalid_key" }, 401);
    const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, key.userId));
    return c.json({ ok: true, user: user?.name ?? null, key: key.name });
  });

  app.post("/api/matches",
    bodyLimit({ maxSize: 512 * 1024, onError: c => c.json({ error: "payload_too_large" }, 413) }),
    async (c, next) => {
      const token = c.req.header("authorization")?.match(/^Bearer (\S+)$/)?.[1];
      const key = token && await findKey(db, token);
      if (!key) return c.json({ error: "invalid_key" }, 401);
      c.set("key", key);
      await next();
    },
    zValidator("json", MatchUpload, invalid),
    async c => {
      const m = c.req.valid("json");
      try {
        const { created } = await saveMatch(db, m, c.get("key"));
        return c.json({ id: m.id, created }, created ? 201 : 200);
      } catch (e) {
        if (e instanceof ConflictError) return c.json({ error: "conflict", message: e.message }, 409);
        throw e;
      }
    });

  app.get("/api/matches",
    zValidator("query", z.object({
      player: z.uuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      before: z.iso.datetime({ offset: true }).optional(),
      minDurationMs: z.coerce.number().int().min(0).optional(),
      maxDurationMs: z.coerce.number().int().min(0).optional(),
      minPlayers: z.coerce.number().int().min(0).optional(),
      maxPlayers: z.coerce.number().int().min(0).optional(),
    }), invalid),
    async c => c.json(await listMatches(db, c.req.valid("query"))));

  app.get("/api/matches/:id",
    zValidator("param", z.object({ id: z.uuid() }), invalid),
    async c => {
      const m = await getMatch(db, c.req.valid("param").id);
      return m ? c.json(m) : c.json({ error: "not_found" }, 404);
    });

  app.get("/api/leaderboard",
    zValidator("query", z.object({ period: z.enum(["all", "month"]).default("all") }), invalid),
    async c => c.json({ players: await leaderboard(db, c.req.valid("query").period) }));

  // per goal: appearances on team cards, completions, average / fastest in-game time to complete
  app.get("/api/goals/stats", async c => c.json({ goals: Object.fromEntries(await goalStats(db)) }));

  app.get("/api/players", async c => c.json({ players: await listPlayers(db) }));

  app.get("/api/players/:uuid",
    zValidator("param", z.object({ uuid: z.uuid() }), invalid),
    async c => {
      const p = await playerProfile(db, c.req.valid("param").uuid);
      return p ? c.json(p) : c.json({ error: "not_found" }, 404);
    });

  if (opts.webDist) {
    const root = opts.webDist;
    const indexHtml = readFileSync(join(root, "index.html"), "utf8");
    const isApi = (c: Context) => c.req.path === "/api" || c.req.path.startsWith("/api/");
    const files = serveStatic({ root });
    app.use("*", async (c, next) => {
      if (isApi(c)) return next();
      const found = await files(c, next);
      // not a file: serveStatic already ran next() (the app shell) and passes its return value through
      if (!(found instanceof Response)) return;
      // Vite's hashed bundles never change; goal art changes per release; the reporter jar every deploy
      const p = c.req.path;
      found.headers.set("Cache-Control", p.startsWith("/assets/") ? "public, max-age=31536000, immutable"
        : p.startsWith("/goals/") || p.startsWith("/yab/") ? "public, max-age=86400"
        : "no-cache");
      return found;
    });
    // client-side routes (/players/…, /matches/…) all load the app shell
    app.get("*", async (c, next) => {
      if (isApi(c)) return next();
      c.header("Cache-Control", "no-cache");
      return c.html(indexHtml);
    });
  }

  app.notFound(c => c.json({ error: "not_found" }, 404));
  app.onError((e, c) => {
    console.error(e);
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}
