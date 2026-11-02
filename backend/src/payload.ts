import { z } from "zod";

// What bingo-reporter sends when a round ends. Mirrors YAB's public API (me.jfenn.bingo.api).
const count = z.number().int().min(0).max(10_000);

const Cell = z.object({
  x: z.number().int().min(0).max(9),
  y: z.number().int().min(0).max(9),
  objectiveId: z.string().min(1).max(200),
  tier: z.enum(["S", "A", "B", "C", "D"]).nullable().default(null),
  completedBy: z.array(z.string()).default([]),
});

const Board = z.object({
  id: z.uuid(),
  seed: z.string().regex(/^-?\d{1,20}$/, "seed must be a Java long written as a string"),
  teams: z.array(z.string()).min(1),
  cells: z.array(Cell).min(1).max(100),
});

const Event = z.object({
  t: z.number().int().min(0).max(7 * 24 * 3600 * 1000),
  type: z.enum(["goal", "lost", "line", "card"]),
  team: z.string(),
  player: z.uuid().nullable().optional(),
  objectiveId: z.string().min(1).max(200).nullable().optional(),
  value: z.number().int().min(0).max(10_000).nullable().optional(),
});

const Team = z.object({
  id: z.string().min(1).max(32),
  items: count,
  lines: count,
  cards: count,
  winner: z.boolean().default(false),
  players: z.array(z.object({ uuid: z.uuid(), name: z.string().min(1).max(16) })).max(100),
});

export const MatchUpload = z.object({
  id: z.uuid(),
  modVersion: z.string().min(1).max(32),
  mcVersion: z.string().min(1).max(32),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  durationMs: z.number().int().min(0).max(7 * 24 * 3600 * 1000),
  options: z.record(z.string(), z.unknown()).default({}),
  teams: z.array(Team).min(1).max(16),
  boards: z.array(Board).min(1).max(16),
  events: z.array(Event).max(5000).default([]),
}).superRefine((m, ctx) => {
  const teamIds = new Set(m.teams.map(t => t.id));
  if (teamIds.size !== m.teams.length) ctx.addIssue({ code: "custom", path: ["teams"], message: "duplicate team id" });
  const seen = new Set<string>();
  m.teams.forEach((t, ti) => t.players.forEach((p, pi) => {
    if (seen.has(p.uuid)) ctx.addIssue({ code: "custom", path: ["teams", ti, "players", pi], message: "player is on more than one team" });
    seen.add(p.uuid);
  }));
  if (Date.parse(m.endedAt) < Date.parse(m.startedAt)) ctx.addIssue({ code: "custom", path: ["endedAt"], message: "endedAt is before startedAt" });
  m.events.forEach((e, i) => {
    if (!teamIds.has(e.team)) ctx.addIssue({ code: "custom", path: ["events", i, "team"], message: `unknown team "${e.team}"` });
  });
  m.boards.forEach((b, bi) => {
    b.teams.forEach((t, i) => { if (!teamIds.has(t)) ctx.addIssue({ code: "custom", path: ["boards", bi, "teams", i], message: `unknown team "${t}"` }); });
    const xy = new Set<string>();
    b.cells.forEach((c, ci) => {
      if (xy.has(`${c.x},${c.y}`)) ctx.addIssue({ code: "custom", path: ["boards", bi, "cells", ci], message: "duplicate cell position" });
      xy.add(`${c.x},${c.y}`);
      c.completedBy.forEach((t, i) => { if (!teamIds.has(t)) ctx.addIssue({ code: "custom", path: ["boards", bi, "cells", ci, "completedBy", i], message: `unknown team "${t}"` }); });
    });
  });
});

export type MatchUpload = z.infer<typeof MatchUpload>;
