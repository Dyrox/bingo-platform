import { DatabaseSync } from "node:sqlite";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "./db/client.ts";
import { matchEvents, matches, matchPlayers, matchTeams, players } from "./db/schema.ts";
import type { Timeline } from "./server-logs.ts";

// Imports YAB's own match history: config/yet-another-minecraft-bingo/bingo.db (stats.db before 2.x),
// an SQLite file with Game, GameTeam and GamePlayer tables (see YAB's sqldelight/…/V1__init.sqm).
// It has results, players, item counts and settings, but not the cards or when anything happened.
// A client that played on someone else's server only records its own team and player.

export const IMPORTED_OPPONENT = "unknown";

const uuid = z.uuid();

export interface YabGame {
  id: string;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  options: Record<string, unknown>;
  teams: { id: string; winner: boolean; items: number; players: { uuid: string; name: string }[] }[];
  partial: boolean;
}

/** Turns YAB's serialized BingoOptions into the flat settings bingo-reporter sends. */
function convertOptions(raw: string): Record<string, unknown> {
  let o: any;
  try { o = JSON.parse(raw); } catch { return {}; }
  const out: Record<string, unknown> = {};
  const wc = o.winCondition;
  if (wc?.type === "cards") out.winCondition = `cards:${wc.cards}`;
  else if (wc?.type) out.winCondition = wc.type;
  const ew = o.endGameWhen;
  if (ew?.type === "teams_win") out.endWhen = `teams_win:${ew.teams}`;
  else if (ew?.type) out.endWhen = ew.type;
  if (typeof o.stalemateBehavior === "string") out.stalemate = o.stalemateBehavior.toLowerCase();
  // java Duration as ISO-8601 ("PT45M") when a time limit was set
  const tl = typeof o.timeLimit === "string" && /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(o.timeLimit);
  if (tl) out.timeLimitSeconds = Number(tl[1] ?? 0) * 3600 + Number(tl[2] ?? 0) * 60 + Math.round(Number(tl[3] ?? 0));
  // what finishes each card, and the first card's modes, as bingo-reporter sends them
  const cards: any[] = Array.isArray(o.cards) ? o.cards : [];
  const goals = cards.map(c => c?.goal?.type === "lines" ? `lines:${c.goal.lines}` : c?.goal?.type === "items" ? `items:${c.goal.items}` : null);
  if (goals.length && goals.every(Boolean)) out.cardGoals = goals;
  const card = cards[0];
  const modes = [card?.isLockoutMode && "lockout", card?.isInventoryMode && "inventory", card?.isHiddenItemsMode && "hidden_items", card?.isConsumeItemsMode && "consume_items", card?.isDraftMode && "draftout"].filter(Boolean);
  if (modes.length) out.mode = modes.join(",");
  if (card?.isHiddenItemsMode && typeof o.showHiddenTiers === "boolean") out.showHiddenTiers = o.showHiddenTiers;
  const flags: [string, string][] = [["isPvpEnabled", "pvp"], ["isElytra", "elytra"], ["isNightVision", "nightVision"], ["isKeepInventory", "keepInventory"],
    ["isUnlockRecipes", "unlockRecipes"], ["isPlayerKit", "playerKit"], ["isTeamKit", "teamKit"]];
  for (const [from, to] of flags) if (typeof o[from] === "boolean") out[to] = o[from];
  if (typeof o.spawnDimension === "string") out.spawnDimension = o.spawnDimension;
  if (typeof o.spawnDistance === "number") out.spawnDistance = o.spawnDistance;
  return out;
}

/** Reads a bingo.db file. Throws if it isn't one. */
export function readYabStats(path: string): YabGame[] {
  const file = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = new Set((file.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map(r => r.name));
    if (!["Game", "GameTeam", "GamePlayer"].every(t => tables.has(t))) throw new Error("not a YAB bingo.db (no Game/GameTeam/GamePlayer tables)");

    const games = file.prepare("select id, bingo_options, started_at, ended_at, duration, player_count, is_draw, is_forfeit from Game").all() as any[];
    const teams = file.prepare("select id, game_id, is_winner from GameTeam").all() as any[];
    const people = file.prepare("select team_id, game_id, minecraft_id, minecraft_name, captured_items from GamePlayer").all() as any[];

    const out: YabGame[] = [];
    for (const g of games) {
      const startedAt = new Date(g.started_at), endedAt = new Date(g.ended_at);
      if (!uuid.safeParse(g.id).success || isNaN(+startedAt) || isNaN(+endedAt)) continue;
      // a player can show up twice in a round (e.g. after switching teams); keep their first row
      const seen = new Set<string>();
      const roster = people.filter(p => p.game_id === g.id && uuid.safeParse(p.minecraft_id).success && !seen.has(p.minecraft_id) && seen.add(p.minecraft_id));
      const gameTeams = teams.filter(t => t.game_id === g.id).map(t => {
        const members = roster.filter(p => p.team_id === t.id);
        return {
          id: String(t.id).slice(0, 32),
          winner: !!t.is_winner,
          items: members.reduce((n, p) => n + Number(p.captured_items || 0), 0),
          players: members.map(p => ({ uuid: String(p.minecraft_id), name: String(p.minecraft_name).slice(0, 16) || "unknown" })),
        };
      }).filter(t => t.players.length > 0);
      if (!gameTeams.length) continue;

      const partial = Number(g.player_count) > roster.length;
      // A client's copy only has its own team. If that team didn't win, and the round neither ended
      // in a draw nor was stopped early, another team must have won: add it so the result counts as a loss.
      if (partial && !gameTeams.some(t => t.winner) && !g.is_draw && !g.is_forfeit) {
        gameTeams.push({ id: IMPORTED_OPPONENT, winner: true, items: 0, players: [] });
      }
      out.push({
        id: g.id, startedAt, endedAt,
        durationMs: Math.max(0, Math.round(Number(g.duration) || 0)),
        options: convertOptions(String(g.bingo_options ?? "{}")),
        teams: gameTeams,
        partial,
      });
    }
    return out;
  } finally {
    file.close();
  }
}

export interface ImportSummary { found: number; imported: number; replaced: number; skipped: number; partial: number; timelines: number; failed: number }

/**
 * Stores imported rounds for `userId`, with timelines from the server's logs where there are some.
 * Rounds bingo-reporter already uploaded are left alone (they have cards and timelines). An earlier
 * import is replaced when this one knows more: more players, or a timeline it lacked. Anything else
 * already here is skipped, so importing the same files twice changes nothing.
 */
export async function importYabGames(db: DB, userId: string, games: YabGame[], timelines = new Map<string, Timeline>()): Promise<ImportSummary> {
  const summary: ImportSummary = { found: games.length, imported: 0, replaced: 0, skipped: 0, partial: 0, timelines: 0, failed: 0 };
  const knownPlayers = (g: YabGame) => g.teams.reduce((n, t) => n + t.players.length, 0);

  for (const g of games) {
    const [prev] = await db.select({
      source: matches.source,
      players: sql<number>`(select count(*)::int from ${matchPlayers} p where p.match_id = ${matches.id})`,
      events: sql<number>`(select count(*)::int from ${matchEvents} e where e.match_id = ${matches.id})`,
    }).from(matches).where(eq(matches.id, g.id));
    const timeline = timelines.get(g.id);
    const better = prev && prev.source === "yab-stats"
      && (prev.players < knownPlayers(g) || (!!timeline?.events.length && prev.events === 0));
    if (prev && !better) {
      summary.skipped++;
      continue;
    }
    // each round on its own: one odd row shouldn't stop the rest of the file
    try { await db.transaction(async tx => {
      if (prev) await tx.delete(matches).where(eq(matches.id, g.id));
      for (const p of g.teams.flatMap(t => t.players)) {
        // don't overwrite a newer name the reporter already stored
        await tx.insert(players).values({ uuid: p.uuid, name: p.name }).onConflictDoNothing();
      }
      await tx.insert(matches).values({
        id: g.id, uploaderId: userId, uploadKeyId: null, modVersion: "unknown", mcVersion: "unknown",
        startedAt: g.startedAt, endedAt: g.endedAt, durationMs: g.durationMs, options: g.options,
        source: "yab-stats", partial: g.partial,
      });
      await tx.insert(matchTeams).values(g.teams.map((t, ord) => ({
        matchId: g.id, teamId: t.id, ord, items: t.items, winner: t.winner,
        // bingo.db has no line or card counts; the server log does
        lines: timeline?.lines.get(t.id) ?? 0, cards: timeline?.cards.get(t.id) ?? 0,
      })));
      const roster = g.teams.flatMap(t => t.players.map(p => ({ matchId: g.id, playerUuid: p.uuid, teamId: t.id, name: p.name })));
      if (roster.length) await tx.insert(matchPlayers).values(roster);
      if (timeline?.events.length) {
        await tx.insert(matchEvents).values(timeline.events.map((e, seq) => ({
          matchId: g.id, seq, tMs: e.t, type: e.type, teamId: e.team, playerUuid: e.player, objectiveId: e.objectiveId, value: e.value,
        })));
      }
    }); } catch (e) {
      console.error(`import: round ${g.id} failed`, e);
      summary.failed++;
      continue;
    }
    if (prev) summary.replaced++; else summary.imported++;
    if (g.partial) summary.partial++;
    if (timeline?.events.length) summary.timelines++;
  }
  return summary;
}
