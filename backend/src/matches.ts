import { and, desc, eq, exists, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { DB } from "./db/client.ts";
import { boardCells, boards, matches, matchEvents, matchPlayers, matchTeams, players, uploadKeys, users } from "./db/schema.ts";
import type { MatchUpload } from "./payload.ts";

export class ConflictError extends Error {}

const isUniqueViolation = (e: unknown) => {
  for (let x: any = e; x; x = x.cause) if (x.code === "23505") return true;
  return false;
};

/**
 * Stores a finished round. Uploading the same round id again replaces it: YAB lets players resume
 * a round after it ended, which ends it again later with the same id and a newer result.
 * Only the user who uploaded a round can replace it.
 */
/**
 * Older reporters only marked a winner once a team had finished a card, which YAB doesn't count when the
 * card is won on lines. When nobody is marked and a "first win" round ended the moment a team scored a
 * line (or card), that team won. Same rule as drizzle/0006_winner_from_last_line.sql.
 */
export function inferWinner(m: MatchUpload): string | null {
  if (m.teams.some(t => t.winner)) return null;
  if (m.options?.endWhen !== "first_win" || !String(m.options?.winCondition ?? "").startsWith("cards:")) return null;
  const last = m.events.filter(e => (e.type === "line" || e.type === "card") && e.t >= m.durationMs - 2000)
    .reduce<MatchUpload["events"][number] | undefined>((a, e) => !a || e.t >= a.t ? e : a, undefined);
  return last && m.teams.some(t => t.id === last.team) ? last.team : null;
}

export async function saveMatch(db: DB, m: MatchUpload, key: typeof uploadKeys.$inferSelect): Promise<{ created: boolean }> {
  let created = true;
  try {
    await db.transaction(async tx => {
      const [prev] = await tx.select({ uploaderId: matches.uploaderId, source: matches.source }).from(matches).where(eq(matches.id, m.id));
      // an import from YAB's bingo.db has no cards or timeline: the reporter's upload always replaces it
      if (prev && prev.source === "reporter" && prev.uploaderId !== key.userId) throw new ConflictError("this round was uploaded by another user");
      if (prev) {
        // teams, players, boards and cells go with it (ON DELETE CASCADE)
        await tx.delete(matches).where(eq(matches.id, m.id));
        created = false;
      }
      const roster = m.teams.flatMap(t => t.players.map(p => ({ ...p, teamId: t.id })));
      for (const p of roster) {
        await tx.insert(players).values({ uuid: p.uuid, name: p.name })
          .onConflictDoUpdate({ target: players.uuid, set: { name: p.name, updatedAt: sql`now()` } });
      }
      await tx.insert(matches).values({
        id: m.id, uploaderId: key.userId, uploadKeyId: key.id,
        modVersion: m.modVersion, mcVersion: m.mcVersion,
        startedAt: new Date(m.startedAt), endedAt: new Date(m.endedAt), durationMs: m.durationMs,
        options: m.options,
      });
      const won = inferWinner(m);
      await tx.insert(matchTeams).values(m.teams.map((t, ord) => ({
        matchId: m.id, teamId: t.id, ord, items: t.items, lines: t.lines, cards: t.cards, winner: t.winner || t.id === won,
      })));
      if (roster.length) {
        await tx.insert(matchPlayers).values(roster.map(p => ({ matchId: m.id, playerUuid: p.uuid, teamId: p.teamId, name: p.name })));
      }
      if (m.events.length) {
        await tx.insert(matchEvents).values(m.events.map((e, seq) => ({
          matchId: m.id, seq, tMs: e.t, type: e.type, teamId: e.team,
          playerUuid: e.player ?? null, objectiveId: e.objectiveId ?? null, value: e.value ?? null,
        })));
      }
      for (const b of m.boards) {
        await tx.insert(boards).values({ id: b.id, matchId: m.id, seed: b.seed, teams: b.teams });
        await tx.insert(boardCells).values(b.cells.map(c => ({ boardId: b.id, ...c })));
      }
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    throw new ConflictError("a board id in this upload already belongs to another match, or the round is being uploaded twice at once");
  }
  await db.update(uploadKeys).set({ lastUsedAt: sql`now()` }).where(eq(uploadKeys.id, key.id));
  return { created };
}

async function teamsFor(db: DB, ids: string[]) {
  if (!ids.length) return new Map<string, any[]>();
  const [teams, roster] = await Promise.all([
    db.select().from(matchTeams).where(inArray(matchTeams.matchId, ids)).orderBy(matchTeams.ord),
    db.select().from(matchPlayers).where(inArray(matchPlayers.matchId, ids)).orderBy(matchPlayers.name),
  ]);
  const out = new Map<string, any[]>();
  for (const t of teams) {
    const list = out.get(t.matchId) ?? [];
    list.push({
      id: t.teamId, items: t.items, lines: t.lines, cards: t.cards, winner: t.winner,
      players: roster.filter(p => p.matchId === t.matchId && p.teamId === t.teamId).map(p => ({ uuid: p.playerUuid, name: p.name })),
    });
    out.set(t.matchId, list);
  }
  return out;
}

const summary = (m: typeof matches.$inferSelect & { uploader: string }) => ({
  id: m.id, modVersion: m.modVersion, mcVersion: m.mcVersion,
  startedAt: m.startedAt.toISOString(), endedAt: m.endedAt.toISOString(), durationMs: m.durationMs,
  uploader: m.uploader,
  source: m.source,
  partial: m.partial,
  excluded: m.excluded,
});

/** Newest first. `before` is the endedAt of the last match on the previous page. */
export interface MatchFilter { minDurationMs?: number; maxDurationMs?: number; minPlayers?: number; maxPlayers?: number }

export async function listMatches(db: DB, q: { player?: string; limit: number; before?: string } & MatchFilter) {
  const playerCount = sql<number>`(select count(*) from ${matchPlayers} where ${matchPlayers.matchId} = ${matches.id})`;
  const where = and(
    q.minDurationMs !== undefined ? gte(matches.durationMs, q.minDurationMs) : undefined,
    q.maxDurationMs !== undefined ? lte(matches.durationMs, q.maxDurationMs) : undefined,
    q.minPlayers !== undefined ? gte(playerCount, q.minPlayers) : undefined,
    q.maxPlayers !== undefined ? lte(playerCount, q.maxPlayers) : undefined,
    q.player ? exists(db.select().from(matchPlayers).where(and(eq(matchPlayers.matchId, matches.id), eq(matchPlayers.playerUuid, q.player)))) : undefined,
    q.before ? lt(matches.endedAt, new Date(q.before)) : undefined,
  );
  const rows = await db.select({ m: matches, uploader: users.name }).from(matches)
    .innerJoin(users, eq(users.id, matches.uploaderId))
    .where(where).orderBy(desc(matches.endedAt), desc(matches.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const teams = await teamsFor(db, page.map(r => r.m.id));
  return {
    matches: page.map(r => ({ ...summary({ ...r.m, uploader: r.uploader }), teams: teams.get(r.m.id) ?? [] })),
    next: rows.length > q.limit ? page.at(-1)!.m.endedAt.toISOString() : null,
  };
}

export async function getMatch(db: DB, id: string) {
  const [row] = await db.select({ m: matches, uploader: users.name }).from(matches)
    .innerJoin(users, eq(users.id, matches.uploaderId)).where(eq(matches.id, id));
  if (!row) return null;
  const [teams, bs, events] = await Promise.all([
    teamsFor(db, [id]),
    db.select().from(boards).where(eq(boards.matchId, id)),
    db.select().from(matchEvents).where(eq(matchEvents.matchId, id)).orderBy(matchEvents.tMs, matchEvents.seq),
  ]);
  const cells = bs.length ? await db.select().from(boardCells).where(inArray(boardCells.boardId, bs.map(b => b.id))).orderBy(boardCells.y, boardCells.x) : [];
  return {
    ...summary({ ...row.m, uploader: row.uploader }),
    options: row.m.options,
    teams: teams.get(id) ?? [],
    boards: bs.map(b => ({
      id: b.id, seed: b.seed, teams: b.teams,
      cells: cells.filter(c => c.boardId === b.id).map(({ boardId, ...c }) => c),
    })),
    events: events.map(e => ({
      t: e.tMs, type: e.type, team: e.teamId, player: e.playerUuid, objectiveId: e.objectiveId, value: e.value,
    })),
  };
}
