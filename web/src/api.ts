// Shapes returned by the backend (see backend/src/matches.ts).

export interface Player { uuid: string; name: string }
export interface Team { id: string; items: number; lines: number; cards: number; winner: boolean; players: Player[] }
export interface Cell { x: number; y: number; objectiveId: string; tier: string | null; completedBy: string[] }
export interface Board { id: string; seed: string; teams: string[]; cells: Cell[] }

export interface MatchSummary {
  id: string;
  modVersion: string;
  mcVersion: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  uploader: string;
  /** "reporter": uploaded live with cards and timeline; "yab-stats": imported from YAB's bingo.db, results only */
  source: 'reporter' | 'yab-stats';
  /** an import that only knows some of the players (a client's bingo.db has just its own team) */
  partial: boolean;
  teams: Team[];
}

/** Timeline entry from bingo-reporter; t is in-game time in ms. */
export interface MatchEvent {
  t: number;
  type: 'goal' | 'lost' | 'line' | 'card';
  team: string;
  player: string | null;
  objectiveId: string | null;
  value: number | null;
}

export interface Match extends MatchSummary {
  options: Record<string, unknown>;
  boards: Board[];
  events: MatchEvent[];
}

export interface MatchPage { matches: MatchSummary[]; next: string | null }

export class NotFound extends Error {}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (res.status === 404) throw new NotFound(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function listMatches(opts: { player?: string; before?: string; limit?: number } = {}) {
  const q = new URLSearchParams();
  if (opts.player) q.set('player', opts.player);
  if (opts.before) q.set('before', opts.before);
  q.set('limit', String(opts.limit ?? 20));
  return get<MatchPage>(`/api/matches?${q}`);
}

export const getMatch = (id: string) => get<Match>(`/api/matches/${encodeURIComponent(id)}`);

export type Result = 'win' | 'loss' | 'draw';

export interface PlayerTotals { games: number; wins: number; losses: number; draws: number; items: number; playtimeMs: number; bestItems: number }

export interface PlayerProfile {
  uuid: string;
  name: string;
  firstPlayed: string | null;
  lastPlayed: string | null;
  allTime: PlayerTotals & { winStreak: number; bestWinStreak: number };
  monthly: PlayerTotals;
  favoriteTeam: { teamId: string; share: number } | null;
  rivals: { uuid: string; name: string; games: number; wins: number; losses: number; draws: number }[];
  goals: { best: (GoalStat & { objectiveId: string })[]; worst: (GoalStat & { objectiveId: string })[] };
  history: { id: string; endedAt: string; durationMs: number; teamId: string; items: number; lines: number; cards: number; teams: number; result: Result }[];
}

/** Per goal, over team cards: how often it came up, was completed, and how long it took (in-game ms). */
export interface GoalStat { appearances: number; completions: number; avgMs: number | null; fastestMs: number | null }
export const getGoalStats = () => get<{ goals: Record<string, GoalStat> }>('/api/goals/stats').then(r => r.goals);

export interface LeaderboardRow extends PlayerTotals {
  uuid: string; name: string; winStreak: number; bestWinStreak: number;
  winRate: number | null; fastestLineMs: number | null; fastestCardMs: number | null;
}
export const getLeaderboard = (period: 'all' | 'month') => get<{ players: LeaderboardRow[] }>(`/api/leaderboard?period=${period}`).then(r => r.players);

export interface PlayerListing { uuid: string; name: string; games: number; lastPlayed: string }

export const getPlayer = (uuid: string) => get<PlayerProfile>(`/api/players/${encodeURIComponent(uuid)}`);
export const listPlayers = () => get<{ players: PlayerListing[] }>('/api/players').then(r => r.players);

export interface Account {
  user: { id: string; name: string; avatarUrl: string | null } | null;
  discord: boolean;
  players?: Player[];
  keys?: { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }[];
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Written by CI next to the jar it builds (public/downloads/reporter.json once deployed). */
export interface ReporterBuild { version: string; file: string; size: number; sha256: string; builtAt: string; commit: string; minecraft: string; yab: string }
export const getReporterBuild = () => get<ReporterBuild>('/downloads/reporter.json');

export const getAccount = () => get<Account>('/api/me');
export const logout = () => send<{ ok: true }>('POST', '/api/auth/logout');
export const createLinkCode = () => send<{ code: string; expiresAt: string }>('POST', '/api/me/link-code');
export const unlinkPlayer = (uuid: string) => send<{ ok: true }>('DELETE', `/api/me/players/${uuid}`);
export const createUploadKey = (name: string) => send<{ key: string; id: string }>('POST', '/api/me/keys', { name });
export interface ImportResult { found: number; imported: number; replaced: number; skipped: number; partial: number }
export async function importYab(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.set('file', file);
  const res = await fetch('/api/me/import/yab', { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status}`);
  return body;
}
export const revokeUploadKey = (id: string) => send<{ ok: true }>('DELETE', `/api/me/keys/${id}`);
