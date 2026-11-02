import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { DB } from "./db/client.ts";
import { matchEvents, matches, matchPlayers, matchTeams, players } from "./db/schema.ts";
import { goalStats } from "./stats.ts";

export type Result = "win" | "loss" | "draw";

/** Everyone who has played (in rounds that count), most recently active first. */
export async function listPlayers(db: DB) {
  const rows = await db.select({
    uuid: players.uuid,
    name: players.name,
    games: sql<number>`count(${matchPlayers.matchId})::int`,
    lastPlayed: sql<Date>`max(${matches.endedAt})`,
  }).from(players)
    .innerJoin(matchPlayers, eq(matchPlayers.playerUuid, players.uuid))
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(eq(matches.excluded, false))
    .groupBy(players.uuid, players.name)
    .orderBy(desc(sql`max(${matches.endedAt})`));
  return rows.map(r => ({ ...r, lastPlayed: new Date(r.lastPlayed).toISOString() }));
}

/**
 * One row per (player, match), oldest first, with the player's team score and result.
 * Results follow YAB's own stats: your team won → win; another team won → loss; nobody won → draw
 * (a solo round that was ended early counts as a draw too).
 */
export async function rounds(db: DB, filter: { player?: string; since?: Date } = {}) {
  // rounds marked "doesn't count" are left out of every statistic
  const where: SQL[] = [eq(matches.excluded, false)];
  if (filter.player) where.push(eq(matchPlayers.playerUuid, filter.player));
  if (filter.since) where.push(gte(matches.endedAt, filter.since));
  const rows = await db.select({
    uuid: matchPlayers.playerUuid,
    name: players.name,
    id: matches.id,
    endedAt: matches.endedAt,
    durationMs: matches.durationMs,
    teamId: matchPlayers.teamId,
    items: matchTeams.items,
    lines: matchTeams.lines,
    cards: matchTeams.cards,
    winner: matchTeams.winner,
    teams: sql<number>`(select count(*)::int from ${matchTeams} t where t.match_id = ${matches.id})`,
    otherWon: sql<boolean>`exists (select 1 from ${matchTeams} t where t.match_id = ${matches.id} and t.winner and t.team_id <> ${matchPlayers.teamId})`,
  }).from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .innerJoin(players, eq(players.uuid, matchPlayers.playerUuid))
    .innerJoin(matchTeams, and(eq(matchTeams.matchId, matchPlayers.matchId), eq(matchTeams.teamId, matchPlayers.teamId)))
    .where(and(...where))
    .orderBy(matches.endedAt, matches.id);

  return rows.map(r => ({
    uuid: r.uuid,
    name: r.name,
    id: r.id,
    endedAt: r.endedAt.toISOString(),
    durationMs: r.durationMs,
    teamId: r.teamId,
    items: r.items,
    lines: r.lines,
    cards: r.cards,
    teams: r.teams,
    result: (r.winner ? "win" : r.otherWon ? "loss" : "draw") as Result,
  }));
}

type Round = Awaited<ReturnType<typeof rounds>>[number];

/** Totals over some rounds. Draws don't break a win streak; losses do. */
export function summarize(list: Round[]) {
  let streak = 0, bestStreak = 0;
  for (const h of list) {
    if (h.result === "win") bestStreak = Math.max(bestStreak, ++streak);
    else if (h.result === "loss") streak = 0;
  }
  const wins = list.filter(h => h.result === "win").length;
  const losses = list.filter(h => h.result === "loss").length;
  return {
    games: list.length,
    wins,
    losses,
    draws: list.length - wins - losses,
    items: list.reduce((n, h) => n + h.items, 0),
    playtimeMs: list.reduce((n, h) => n + h.durationMs, 0),
    bestItems: list.reduce((n, h) => Math.max(n, h.items), 0),
    winStreak: streak,
    bestWinStreak: bestStreak,
  };
}

/**
 * In-game time of each team's first line and first completed card per match, from the timelines.
 * Rounds uploaded before the reporter recorded timelines simply have none.
 */
async function firsts(db: DB, matchIds: string[]) {
  const out = new Map<string, { line?: number; card?: number }>();
  if (!matchIds.length) return out;
  const rows = await db.select({
    matchId: matchEvents.matchId,
    teamId: matchEvents.teamId,
    type: matchEvents.type,
    t: sql<number>`min(${matchEvents.tMs})::float8`,
  }).from(matchEvents)
    .where(and(inArray(matchEvents.matchId, matchIds), inArray(matchEvents.type, ["line", "card"])))
    .groupBy(matchEvents.matchId, matchEvents.teamId, matchEvents.type);
  for (const r of rows) {
    const k = `${r.matchId}/${r.teamId}`;
    out.set(k, { ...out.get(k), [r.type]: r.t });
  }
  return out;
}

const minOf = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => x !== undefined);
  return v.length ? Math.min(...v) : null;
};

/** Everyone ranked by wins (then win rate, then items), all time or since the start of this month. */
export async function leaderboard(db: DB, period: "all" | "month", now = new Date()) {
  const since = period === "month" ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) : undefined;
  const all = await rounds(db, { since });
  const first = await firsts(db, [...new Set(all.map(r => r.id))]);

  const byPlayer = new Map<string, Round[]>();
  for (const r of all) byPlayer.set(r.uuid, [...(byPlayer.get(r.uuid) ?? []), r]);

  return [...byPlayer.values()].map(list => {
    const s = summarize(list);
    const decided = s.wins + s.losses;
    return {
      uuid: list[0].uuid,
      name: list.at(-1)!.name,
      ...s,
      winRate: decided ? s.wins / decided : null,
      fastestLineMs: minOf(list.map(r => first.get(`${r.id}/${r.teamId}`)?.line)),
      fastestCardMs: minOf(list.map(r => first.get(`${r.id}/${r.teamId}`)?.card)),
    };
  }).sort((a, b) => b.wins - a.wins || (b.winRate ?? -1) - (a.winRate ?? -1) || b.items - a.items || a.name.localeCompare(b.name));
}

/** Everyone the player has played against, with the player's record against them. */
async function rivals(db: DB, mine: Round[]) {
  if (!mine.length) return [];
  const myTeam = new Map(mine.map(r => [r.id, r]));
  const others = await db.select({ matchId: matchPlayers.matchId, uuid: matchPlayers.playerUuid, teamId: matchPlayers.teamId, name: players.name })
    .from(matchPlayers).innerJoin(players, eq(players.uuid, matchPlayers.playerUuid))
    .where(inArray(matchPlayers.matchId, [...myTeam.keys()]));

  const out = new Map<string, { uuid: string; name: string; games: number; wins: number; losses: number; draws: number }>();
  for (const o of others) {
    const me = myTeam.get(o.matchId)!;
    if (o.teamId === me.teamId) continue; // a teammate, not an opponent
    const r = out.get(o.uuid) ?? { uuid: o.uuid, name: o.name, games: 0, wins: 0, losses: 0, draws: 0 };
    r.games++;
    r[me.result === "win" ? "wins" : me.result === "loss" ? "losses" : "draws"]++;
    out.set(o.uuid, r);
  }
  return [...out.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

/**
 * A player's totals, rivals, best and worst goals, plus a light per-match history (oldest first) for charts.
 */
export async function playerProfile(db: DB, uuid: string, now = new Date()) {
  const [player] = await db.select().from(players).where(eq(players.uuid, uuid));
  if (!player) return null;

  const mine = await rounds(db, { player: uuid });
  const history = mine.map(({ uuid: _u, name: _n, ...h }) => h);
  const { winStreak, bestWinStreak, ...allTime } = summarize(mine);
  const { winStreak: _w, bestWinStreak: _b, ...monthly } = summarize(mine.filter(r => new Date(r.endedAt) >= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))));

  const teamCounts = new Map<string, number>();
  for (const h of mine) teamCounts.set(h.teamId, (teamCounts.get(h.teamId) ?? 0) + 1);
  const [favTeam, favCount] = [...teamCounts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];

  // goals on this player's own cards: done most often (and fastest) vs. missed most often
  const goals = [...(await goalStats(db, mine.map(r => ({ matchId: r.id, teamId: r.teamId })))).entries()]
    .map(([objectiveId, s]) => ({ objectiveId, ...s }));
  const best = goals.filter(g => g.completions > 0)
    .sort((a, b) => b.completions - a.completions || (a.avgMs ?? Infinity) - (b.avgMs ?? Infinity)).slice(0, 6);
  const worst = goals.filter(g => g.appearances > g.completions)
    .sort((a, b) => (b.appearances - b.completions) - (a.appearances - a.completions) || a.completions / a.appearances - b.completions / b.appearances).slice(0, 6);

  return {
    uuid: player.uuid,
    name: player.name,
    firstPlayed: history[0]?.endedAt ?? null,
    lastPlayed: history.at(-1)?.endedAt ?? null,
    allTime: { ...allTime, winStreak, bestWinStreak },
    monthly,
    favoriteTeam: favTeam ? { teamId: favTeam, share: favCount / history.length } : null,
    rivals: await rivals(db, mine),
    goals: { best, worst },
    history,
  };
}
