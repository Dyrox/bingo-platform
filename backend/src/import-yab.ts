import { DatabaseSync } from "node:sqlite";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "./db/client.ts";
import { matches, matchPlayers, matchTeams, players } from "./db/schema.ts";

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
  const card = o.cards?.[0];
  if (card?.goal?.type === "lines") out.goal = `lines:${card.goal.lines}`;
  else if (card?.goal?.type === "items") out.goal = `items:${card.goal.items}`;
  const modes = [card?.isLockoutMode && "lockout", card?.isInventoryMode && "inventory", card?.isHiddenItemsMode && "hidden_items"].filter(Boolean);
  if (modes.length) out.mode = modes.join(",");
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

export interface ImportSummary { found: number; imported: number; replaced: number; skipped: number; partial: number }

/**
 * Stores imported rounds for `userId`. Rounds bingo-reporter already uploaded are left alone (they
 * have cards and timelines); an earlier partial import is replaced by a fuller one; anything else
 * already here is skipped, so importing the same file twice changes nothing.
 */
export async function importYabGames(db: DB, userId: string, games: YabGame[]): Promise<ImportSummary> {
  const summary: ImportSummary = { found: games.length, imported: 0, replaced: 0, skipped: 0, partial: 0 };
  const knownPlayers = (g: YabGame) => g.teams.reduce((n, t) => n + t.players.length, 0);

  for (const g of games) {
    const [prev] = await db.select({ source: matches.source, partial: matches.partial, players: sql<number>`(select count(*)::int from ${matchPlayers} p where p.match_id = ${matches.id})` })
      .from(matches).where(eq(matches.id, g.id));
    if (prev && (prev.source !== "yab-stats" || !prev.partial || prev.players >= knownPlayers(g))) {
      summary.skipped++;
      continue;
    }
    await db.transaction(async tx => {
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
        matchId: g.id, teamId: t.id, ord, items: t.items, lines: 0, cards: 0, winner: t.winner,
      })));
      const roster = g.teams.flatMap(t => t.players.map(p => ({ matchId: g.id, playerUuid: p.uuid, teamId: t.id, name: p.name })));
      if (roster.length) await tx.insert(matchPlayers).values(roster);
    });
    if (prev) summary.replaced++; else summary.imported++;
    if (g.partial) summary.partial++;
  }
  return summary;
}
