import { gunzipSync } from "node:zlib";
import type { YabGame } from "./import-yab.ts";

// Timelines for imported rounds, rebuilt from a YAB server's own logs (logs/latest.log, logs/*.log.gz).
// YAB's ScoredItemCheck logs every goal a player gets and every score change, to the second:
//   [02:19:18] [Server thread/INFO]: [ScoredItemCheck] Dyrox2333 got minecraft:birch_stairs
//   [02:19:18] [Server thread/INFO]: [ScoredItemCheck] Updated score for team bingo_blue: TeamScore(items=1, lines=0, cards=0)
//   [01:36:17] [Server thread/INFO]: [ScoredItemCheck] Team bingo_pink has completed their card
// Log lines carry only a local time of day and the server's time zone isn't recorded, so a log round
// is tied to a bingo.db round by when it ended, how long it lasted and every team's final item count.

export interface LogRound {
  playing: number;            // wall-clock ms (local, arbitrary day) when the round started playing
  end: number;                // when its (last) result was written
  durationS: number | null;   // YAB's own "Game duration" from the end summary
  got: { at: number; player: string; objectiveId: string; team: string | null }[];
  score: { at: number; team: string; items: number; lines: number; cards: number }[];
  cardDone: { at: number; team: string }[];
}

export interface Timeline {
  events: { t: number; type: "goal" | "line" | "card"; team: string; player: string | null; objectiveId: string | null; value: number | null }[];
  lines: Map<string, number>;
  cards: Map<string, number>;
}

const LINE = /^\[(\d\d):(\d\d):(\d\d)\] \[Server thread\/INFO\]: (.*)$/;
const DAY = 86_400_000;

/** Reads log files (plain or gzipped) in name order, which is time order for Minecraft's log names. */
export function parseServerLogs(files: { name: string; data: Uint8Array }[]): LogRound[] {
  const rounds: LogRound[] = [];
  for (const f of [...files].sort((a, b) => (a.name === "latest.log" ? 1 : 0) - (b.name === "latest.log" ? 1 : 0) || a.name.localeCompare(b.name))) {
    let text: string;
    try { text = new TextDecoder().decode(f.name.endsWith(".gz") ? gunzipSync(f.data) : f.data); } catch { continue; }
    let day = 0, prev = -Infinity, cur: LogRound | null = null;
    for (const raw of text.split("\n")) {
      const m = LINE.exec(raw.replace(/\r$/, ""));
      if (!m) continue;
      let at = day + ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000;
      if (at < prev - 3_600_000) { day += DAY; at += DAY; } // past midnight
      prev = at;
      const msg = m[4];
      let g: RegExpExecArray | null;
      if (msg.includes("GameState changed: COUNTDOWN -> PLAYING")) {
        cur = { playing: at, end: 0, durationS: null, got: [], score: [], cardDone: [] };
        rounds.push(cur);
      } else if (!cur) {
        continue;
      } else if ((g = /^\[ScoredItemCheck\] (\S+) got (\S+)$/.exec(msg))) {
        cur.got.push({ at, player: g[1], objectiveId: g[2], team: null });
      } else if ((g = /^\[ScoredItemCheck\] Updated score for team (\S+): TeamScore\(items=(\d+), lines=(\d+), cards=(\d+)\)/.exec(msg))) {
        cur.score.push({ at, team: g[1], items: +g[2], lines: +g[3], cards: +g[4] });
        // the score line right after a "got" line belongs to that player's team
        const last = cur.got.at(-1);
        if (last && !last.team && last.at === at) last.team = g[1];
      } else if ((g = /^\[ScoredItemCheck\] Team (\S+) has completed their card/.exec(msg))) {
        cur.cardDone.push({ at, team: g[1] });
      } else if (msg.trim() === "Writing game result to stats.db...") {
        // a resumed round ends again under the same id; bingo.db keeps the last result, so do we
        cur.end = at;
        cur.durationS = null;
      } else if ((g = /^\s*Game duration: (?:(\d+)d )?(?:(\d+)h )?(?:(\d+)m )?(\d+)s/.exec(msg))) {
        cur.durationS = ((+(g[1] ?? 0) * 24 + +(g[2] ?? 0)) * 60 + +(g[3] ?? 0)) * 60 + +g[4];
      }
    }
  }
  return rounds.filter(r => r.end > 0);
}

const timeOfDay = (ms: number) => ((ms % DAY) + DAY) % DAY;

/**
 * Ties log rounds to bingo.db rounds and builds their timelines. A log round only counts when exactly one
 * game fits: same end time of day (±5 s) for some whole-hour time zone offset, same duration (±2 s) when
 * the log has one, and every team's final item count equal to bingo.db's. Anything doubtful is left out.
 */
export function attachTimelines(games: YabGame[], rounds: LogRound[]): Map<string, Timeline> {
  const out = new Map<string, Timeline>();
  const claimed = new Map<string, number>();

  rounds.forEach((r, i) => {
    const final = new Map<string, number>();
    for (const s of r.score) final.set(s.team, s.items);
    const fits = new Set<string>();
    for (const g of games) {
      // difference in time of day, wrapped into ±12 h (a server 8 h ahead of UTC shows up as -8 h or +16 h)
      const endDiff = timeOfDay(timeOfDay(g.endedAt.getTime()) - timeOfDay(r.end) + DAY / 2) - DAY / 2;
      // nearest whole-hour offset; then what's left must be a few seconds
      const off = Math.round(endDiff / 3_600_000) * 3_600_000;
      if (Math.abs(endDiff - off) > 5000) continue;
      if (r.durationS !== null && Math.abs(g.durationMs / 1000 - r.durationS) > 2) continue;
      const items = new Map(g.teams.map(t => [t.id, t.items]));
      if ([...final].some(([team, n]) => items.has(team) && items.get(team) !== n)) continue;
      if (final.size && ![...final.keys()].some(team => items.has(team))) continue;
      fits.add(g.id);
    }
    if (fits.size !== 1) return;
    const id = [...fits][0];
    claimed.set(id, (claimed.get(id) ?? 0) + 1);

    const game = games.find(g => g.id === id)!;
    const teamOf = new Map(game.teams.flatMap(t => t.players.map(p => [p.name, t.id] as const)));
    const uuidOf = new Map(game.teams.flatMap(t => t.players.map(p => [p.name, p.uuid] as const)));
    const t = (at: number) => Math.max(0, at - r.playing);
    const tl: Timeline = { events: [], lines: new Map(), cards: new Map() };
    for (const e of r.got) {
      const team = e.team ?? teamOf.get(e.player);
      if (!team) continue;
      tl.events.push({ t: t(e.at), type: "goal", team, player: uuidOf.get(e.player) ?? null, objectiveId: e.objectiveId, value: null });
    }
    const lines = new Map<string, number>();
    for (const s of r.score) {
      if (s.lines > (lines.get(s.team) ?? 0)) tl.events.push({ t: t(s.at), type: "line", team: s.team, player: null, objectiveId: null, value: s.lines });
      lines.set(s.team, s.lines);
      tl.lines.set(s.team, s.lines);
      tl.cards.set(s.team, s.cards);
    }
    const done = new Map<string, number>();
    for (const c of r.cardDone) {
      done.set(c.team, (done.get(c.team) ?? 0) + 1);
      tl.events.push({ t: t(c.at), type: "card", team: c.team, player: null, objectiveId: null, value: done.get(c.team)! });
      tl.cards.set(c.team, Math.max(tl.cards.get(c.team) ?? 0, done.get(c.team)!));
    }
    tl.events.sort((a, b) => a.t - b.t);
    out.set(id, tl);
  });

  // two log rounds claiming one game means something is off: keep neither
  for (const [id, n] of claimed) if (n > 1) out.delete(id);
  return out;
}
