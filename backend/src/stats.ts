import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "./db/client.ts";
import { boardCells, boards, matchEvents, matches } from "./db/schema.ts";

export interface GoalStat {
  /** times a team had this goal on its card */
  appearances: number;
  /** times that team completed it (as of the end of the round) */
  completions: number;
  /** in-game time to complete, averaged over rounds that have a timeline */
  avgMs: number | null;
  fastestMs: number | null;
}

/**
 * Per-goal statistics over team cards. Each team on a card counts separately, so a card shared by
 * two teams is two appearances. `only` limits it to particular (match, team) pairs, e.g. one player's rounds.
 */
export async function goalStats(db: DB, only?: { matchId: string; teamId: string }[]) {
  const out = new Map<string, GoalStat & { times: number[] }>();
  if (only && !only.length) return new Map<string, GoalStat>();
  const wanted = only && new Set(only.map(o => `${o.matchId}/${o.teamId}`));
  const matchIds = only && [...new Set(only.map(o => o.matchId))];

  const cells = await db.select({ matchId: boards.matchId, teams: boards.teams, objectiveId: boardCells.objectiveId, completedBy: boardCells.completedBy })
    .from(boardCells).innerJoin(boards, eq(boards.id, boardCells.boardId))
    .innerJoin(matches, eq(matches.id, boards.matchId))
    .where(and(eq(matches.excluded, false), matchIds ? inArray(boards.matchId, matchIds) : undefined));
  for (const c of cells) {
    for (const team of c.teams) {
      if (wanted && !wanted.has(`${c.matchId}/${team}`)) continue;
      const s = out.get(c.objectiveId) ?? { appearances: 0, completions: 0, avgMs: null, fastestMs: null, times: [] };
      s.appearances++;
      if (c.completedBy.includes(team)) s.completions++;
      out.set(c.objectiveId, s);
    }
  }

  // first time each team got each goal in each round (a goal can be lost and regained)
  const times = await db.select({
    matchId: matchEvents.matchId, teamId: matchEvents.teamId, objectiveId: matchEvents.objectiveId,
    t: sql<number>`min(${matchEvents.tMs})::int`,
  }).from(matchEvents)
    .innerJoin(matches, eq(matches.id, matchEvents.matchId))
    .where(and(eq(matchEvents.type, "goal"), eq(matches.excluded, false), matchIds ? inArray(matchEvents.matchId, matchIds) : undefined))
    .groupBy(matchEvents.matchId, matchEvents.teamId, matchEvents.objectiveId);
  for (const r of times) {
    if (!r.objectiveId || (wanted && !wanted.has(`${r.matchId}/${r.teamId}`))) continue;
    out.get(r.objectiveId)?.times.push(r.t);
  }

  return new Map<string, GoalStat>([...out].map(([id, { times: ts, ...s }]) => [id, {
    ...s,
    avgMs: ts.length ? Math.round(ts.reduce((a, b) => a + b, 0) / ts.length) : null,
    fastestMs: ts.length ? Math.min(...ts) : null,
  }]));
}
