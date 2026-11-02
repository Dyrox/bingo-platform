import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Website accounts. Login (Discord etc.) comes later; for now users are created by the key script.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  discordId: text("discord_id").unique(),
  // Discord avatar URL, refreshed on every login
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Website logins. The cookie holds a random token; only its SHA-256 is stored.
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Short-lived codes for "/bingo link <code>": shown on the website, typed in game.
export const linkCodes = pgTable("link_codes", {
  code: text("code").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedBy: uuid("used_by"),
});

// One key per computer that runs bingo-reporter. Only the SHA-256 of the key is stored.
export const uploadKeys = pgTable("upload_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  // first characters of the key, so the website can show "bgr_7Kq2…" without knowing the rest
  prefix: text("prefix").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// Minecraft accounts seen in uploads. user_id is filled in once the player runs /bingo link.
export const players = pgTable("players", {
  uuid: uuid("uuid").primaryKey(),
  name: text("name").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// The id is YAB's own round id, so re-sending the same round never creates a duplicate.
export const matches = pgTable("matches", {
  id: uuid("id").primaryKey(),
  uploaderId: uuid("uploader_id").notNull().references(() => users.id),
  uploadKeyId: uuid("upload_key_id").references(() => uploadKeys.id, { onDelete: "set null" }),
  modVersion: text("mod_version").notNull(),
  mcVersion: text("mc_version").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  // bigint: imported rounds can have been left running for weeks (past int32's ~24.8 days)
  durationMs: bigint("duration_ms", { mode: "number" }).notNull(),
  options: jsonb("options").notNull().default({}),
  // "reporter": uploaded by bingo-reporter (cards, timeline); "yab-stats": imported from YAB's own bingo.db
  // (results only, no cards)
  source: text("source").notNull().default("reporter"),
  // an import that only knows some of the players: a client's bingo.db records just its own team
  partial: boolean("partial").notNull().default(false),
  // still listed and viewable, but left out of every statistic (records, leaderboard, goal stats)
  excluded: boolean("excluded").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("matches_ended_at_idx").on(t.endedAt)]);

export const matchTeams = pgTable("match_teams", {
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull(),
  // order the teams were sent in, so they come back the same way
  ord: integer("ord").notNull(),
  items: integer("items").notNull(),
  lines: integer("lines").notNull(),
  cards: integer("cards").notNull(),
  winner: boolean("winner").notNull().default(false),
}, t => [primaryKey({ columns: [t.matchId, t.teamId] })]);

export const matchPlayers = pgTable("match_players", {
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  playerUuid: uuid("player_uuid").notNull().references(() => players.uuid),
  teamId: text("team_id").notNull(),
  // name at the time of the match; players.name always holds the latest one
  name: text("name").notNull(),
}, t => [primaryKey({ columns: [t.matchId, t.playerUuid] }), index("match_players_player_idx").on(t.playerUuid)]);

// Usually every team shares one card, but YAB can give teams separate cards, so a match has 1..n boards.
export const boards = pgTable("boards", {
  id: uuid("id").primaryKey(),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  // Java long; kept as text because it doesn't fit in a JS number
  seed: text("seed").notNull(),
  teams: text("teams").array().notNull(),
}, t => [index("boards_match_idx").on(t.matchId)]);

// The round's timeline as bingo-reporter saw it: t is in-game time in ms; type is goal / lost / line / card.
// Rounds uploaded before the reporter tracked this simply have none.
export const matchEvents = pgTable("match_events", {
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  tMs: bigint("t_ms", { mode: "number" }).notNull(),
  type: text("type").notNull(),
  teamId: text("team_id").notNull(),
  playerUuid: uuid("player_uuid"),
  objectiveId: text("objective_id"),
  value: integer("value"),
}, t => [primaryKey({ columns: [t.matchId, t.seq] })]);

export const boardCells = pgTable("board_cells", {
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  objectiveId: text("objective_id").notNull(),
  tier: text("tier"),
  completedBy: text("completed_by").array().notNull().default([]),
}, t => [primaryKey({ columns: [t.boardId, t.x, t.y] })]);
