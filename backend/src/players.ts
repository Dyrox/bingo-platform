import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "./db/client.ts";
import { matches, matchPlayers, matchTeams, players } from "./db/schema.ts";

export type Result = "win" | "loss" | "draw";

/** Everyone who has played, most recently active first. */
export async function listPlayers(db: DB) {
  const rows = await db.select({
    uuid: players.uuid,
    name: players.name,
    games: sql<number>`count(${matchPlayers.matchId})::int`,
    lastPlayed: sql<Date>`max(${matches.endedAt})`,
  }).from(players)
    .innerJoin(matchPlayers, eq(matchPlayers.playerUuid, players.uuid))
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .groupBy(players.uuid, players.name)
    .orderBy(desc(sql`max(${matches.endedAt})`));
  return rows.map(r => ({ ...r, lastPlayed: new Date(r.lastPlayed).toISOString() }));
}

/**
 * A player's totals plus a light per-match history (oldest first) for charts.
 * Results follow YAB's own stats: your team won → win; another team won → loss; nobody won → draw
 * (a solo round that was ended early counts as a draw too). Draws don't break a win streak.
 */
export async function playerProfile(db: DB, uuid: string, now = new Date()) {
  const [player] = await db.select().from(players).where(eq(players.uuid, uuid));
  if (!player) return null;

  const rows = await db.select({
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
    .innerJoin(matchTeams, and(eq(matchTeams.matchId, matchPlayers.matchId), eq(matchTeams.teamId, matchPlayers.teamId)))
    .where(eq(matchPlayers.playerUuid, uuid))
    .orderBy(matches.endedAt);

  const history = rows.map(r => ({
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

  const sum = (list: typeof history) => ({
    games: list.length,
    wins: list.filter(h => h.result === "win").length,
    losses: list.filter(h => h.result === "loss").length,
    draws: list.filter(h => h.result === "draw").length,
    items: list.reduce((n, h) => n + h.items, 0),
    playtimeMs: list.reduce((n, h) => n + h.durationMs, 0),
    bestItems: list.reduce((n, h) => Math.max(n, h.items), 0),
  });

  let streak = 0, bestStreak = 0;
  for (const h of history) {
    if (h.result === "win") bestStreak = Math.max(bestStreak, ++streak);
    else if (h.result === "loss") streak = 0;
  }

  const teamCounts = new Map<string, number>();
  for (const h of history) teamCounts.set(h.teamId, (teamCounts.get(h.teamId) ?? 0) + 1);
  const [favTeam, favCount] = [...teamCounts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    uuid: player.uuid,
    name: player.name,
    firstPlayed: history[0]?.endedAt ?? null,
    lastPlayed: history.at(-1)?.endedAt ?? null,
    allTime: { ...sum(history), winStreak: streak, bestWinStreak: bestStreak },
    monthly: sum(history.filter(h => new Date(h.endedAt) >= monthStart)),
    favoriteTeam: favTeam ? { teamId: favTeam, share: favCount / history.length } : null,
    history,
  };
}
