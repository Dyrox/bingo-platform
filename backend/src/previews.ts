import type { Hono } from "hono";
import { z } from "zod";
import type { DB } from "./db/client.ts";
import { getMatch } from "./matches.ts";
import { bannerImage, clock, matchImage, modeName, Painter, teamName, teamStyle, version, type MatchData } from "./og.ts";
import { leaderboard, playerProfile } from "./players.ts";

// Link previews: /og/*.png draws the picture, pageMeta() says what goes in each page's <meta> tags.
// Pictures are cached for a while; their links carry ?v=<hash of what's drawn>, so an edited match
// (a new upload, "doesn't count", a fixed winner) gets a new picture even where Discord cached the old one.

const TTL = 10 * 60_000;
const cache = new Map<string, { at: number; png: Buffer }>();
async function cached(key: string, draw: () => Promise<Buffer>) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.png;
  const png = await draw();
  cache.set(key, { at: Date.now(), png });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return png;
}

const uuid = z.uuid();
const png = (body: Buffer) => new Response(new Uint8Array(body), { headers: { "content-type": "image/png", "cache-control": "public, max-age=600" } });

/** What a match picture shows; its hash is the ?v= of the picture's link. */
const drawn = (m: MatchData) => ({ teams: m.teams, cells: m.boards.map(b => b.cells), modes: m.modes, excluded: m.excluded });

export function registerPreviews(app: Hono<any>, db: DB, root: string) {
  const painter = new Painter(root);

  app.get("/og/match/:file", async c => {
    const id = c.req.param("file").replace(/\.png$/, "");
    if (!uuid.safeParse(id).success) return c.notFound();
    const m = await getMatch(db, id) as MatchData | null;
    if (!m) return c.notFound();
    return png(await cached(`m:${id}:${version(drawn(m))}`, () => matchImage(painter, m)));
  });

  app.get("/og/home.png", async () => png(await cached("home", async () => {
    const board = await leaderboard(db, "all");
    return bannerImage(painter, "Bingo match history", [
      { text: `${board.length} players - replays, records & tier guide` },
      ...board.slice(0, 3).map((p, i) => ({ text: `${i + 1}. ${p.name}  ${p.wins}W ${p.losses}L ${p.draws}D`, color: i === 0 ? "#ffd84a" : "#e8ece4" })),
    ]);
  })));

  app.get("/og/player/:file", async c => {
    const id = c.req.param("file").replace(/\.png$/, "");
    if (!uuid.safeParse(id).success) return c.notFound();
    const p = await playerProfile(db, id);
    if (!p) return c.notFound();
    const a = p.allTime;
    const rate = a.wins + a.losses ? Math.round((a.wins / (a.wins + a.losses)) * 100) : null;
    return png(await cached(`p:${id}:${version(a)}`, () => bannerImage(painter, p.name, [
      { text: `${a.games} rounds  -  ${a.wins}W ${a.losses}L ${a.draws}D${rate === null ? "" : `  -  ${rate}% won`}`, color: "#e8ece4" },
      { text: `${a.items} items collected${a.bestWinStreak ? `  -  best streak ${a.bestWinStreak}` : ""}` },
    ])));
  });
}

const HOME = {
  title: "Bingo 对战平台",
  description: "Yet Another Minecraft BINGO / Bingout 的对局记录：回放、战绩、排行榜和难度图鉴。",
};

/** The <meta> tags for a page of the site (null: leave index.html as it is). */
export async function pageMeta(db: DB, path: string, site: string) {
  const url = site + path;
  // a match: /matches/<id>, or the records view /players/<uuid>/records/<id>
  const matchId = /^\/matches\/([0-9a-f-]{36})\/?$/.exec(path)?.[1] ?? /^\/players\/[0-9a-f-]{36}\/records\/([0-9a-f-]{36})\/?$/.exec(path)?.[1];
  if (matchId) {
    const m = await getMatch(db, matchId) as MatchData | null;
    if (!m) return null;
    const winners = m.teams.filter(t => t.winner);
    const label = (t: MatchData["teams"][number]) => t.players.length ? t.players.map(p => p.name).join("、") : teamName(t.id, true);
    const title = winners.length ? `${winners.map(label).join(" 和 ")} 获胜` : "无人获胜";
    const score = m.teams.filter(t => t.players.length).map(t => `${label(t)} ${t.items}`).join(" vs ");
    const extra = [`用时 ${clock(m.durationMs)}`, ...(m.modes ?? []).map(x => modeName(x, true)), ...(m.modName && m.modName !== "Yet Another Minecraft BINGO" ? [m.modName] : []),
      ...(m.excluded ? ["不计入统计"] : [])];
    return {
      title: `${title} · ${m.endedAt.slice(0, 10)}`,
      description: `${score}\n${extra.join(" · ")}`,
      image: `${site}/og/match/${m.id}.png?v=${version(drawn(m))}`,
      url, color: winners.length ? teamStyle(winners[0].id).accent : undefined,
    };
  }
  const playerId = /^\/players\/([0-9a-f-]{36})(?:\/records)?\/?$/.exec(path)?.[1];
  if (playerId) {
    const p = await playerProfile(db, playerId);
    if (!p) return null;
    const a = p.allTime;
    return {
      title: `${p.name} · Bingo 战绩`,
      description: `${a.games} 局 · ${a.wins} 胜 ${a.losses} 负 ${a.draws} 平 · 共 ${a.items} 个物品`,
      image: `${site}/og/player/${p.uuid}.png?v=${version(a)}`, url,
    };
  }
  const page: Record<string, string> = { "/matches": "全部对局", "/players": "玩家", "/leaderboard": "排行榜", "/guide": "Bingo 难度图鉴", "/bans": "自定义禁用" };
  const name = page[path.replace(/\/$/, "")];
  return { title: name ? `${name} · ${HOME.title}` : HOME.title, description: HOME.description, image: `${site}/og/home.png`, url };
}
