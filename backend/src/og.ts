import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import cardColors from "./card_colors.json" with { type: "json" };

// Link previews (Discord, Slack, iMessage…): they don't run the site's JavaScript, they read <meta> tags from
// the HTML and show the og:image. So the server writes those tags into index.html per page, and draws the
// images here: a match as its team cards (like the site and the mod's end screen), the home page and players
// as a banner. Everything is pixel art, drawn at 1 "card pixel" and blown up with nearest-neighbour; text uses
// Minecraft's bitmap font (yab/ascii.png, as the site's McText does), so no system fonts are needed. That font
// has no Chinese, so the pictures are in English and the page title/description carry the Chinese.

export const W = 1200, H = 630;
const BG = "#1d201f", WHITE = "#ffffff", MUTED = "#9aa3a0", ACHIEVED = "#55ff55";

type RGB = [number, number, number];
const rgb = (hex: string): RGB => { const h = hex.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as RGB; };

// ---- team cards, as in web/src/teams.ts (card_colors.json is the mod's own, copied from web/src) ----------
type CardStyle = { textColor: string; outlineColor: string };
const CARDS = cardColors.teams as Record<string, CardStyle>;
const ALIAS: Record<string, string> = { gold: "orange", light_purple: "pink", dark_aqua: "aqua", dark_blue: "blue", dark_green: "green", dark_red: "red", dark_gray: "gray", white: "gray" };
const bare = (id: string) => id.replace(/^bingo_/, "");
const cardKey = (id: string) => { const k = ALIAS[bare(id)] ?? bare(id); return CARDS[k] ? k : "preview"; };
const argb = (hex: string) => { const h = hex.replace("#", ""); return h.length === 8 ? `#${h.slice(2)}` : `#${h}`; };
export function teamStyle(id: string) {
  const k = cardKey(id);
  return { frame: `yab/card_${k}.png`, text: argb(CARDS[k].textColor), accent: k === "preview" ? argb(CARDS.gray.outlineColor) : argb(CARDS[k].outlineColor) };
}
const EN: Record<string, string> = { red: "Red", orange: "Orange", gold: "Orange", yellow: "Yellow", green: "Green", aqua: "Aqua", blue: "Blue", pink: "Pink",
  light_purple: "Pink", purple: "Purple", gray: "Gray", white: "White", black: "Black", unknown: "Other team" };
const ZH: Record<string, string> = { red: "红队", orange: "橙队", gold: "橙队", yellow: "黄队", green: "绿队", aqua: "青队", blue: "蓝队", pink: "粉队",
  light_purple: "粉队", purple: "紫队", gray: "灰队", white: "白队", black: "黑队", unknown: "其他队伍" };
export const teamName = (id: string, zh = false) => (zh ? ZH : EN)[bare(id)] ?? bare(id).replace(/_/g, " ");
const cardLabel = (id: string, players: { name: string }[]) => players.length === 1 ? players[0].name : `${teamName(id)} Team`;
const MODES: Record<string, [string, string]> = { lockout: ["Lockout", "抢夺模式"], inventory: ["Inventory", "物品占领模式"], hidden_items: ["Hidden Items", "隐藏任务模式"],
  consume_items: ["Consume Items", "消耗模式"], draftout: ["Draftout", "Draftout 轮选"] };
export const modeName = (m: string, zh = false) => MODES[m]?.[zh ? 1 : 0] ?? m;

interface Goal { c: string; k?: string; i?: string; img?: string; s?: "one" | "all"; ii?: string[]; x?: 1 }

/** Loads files from the built site and draws with them; one per server. */
export class Painter {
  private fontLoad: Promise<{ px: Buffer; w: number; widths: number[] }> | null = null;
  private files = new Map<string, Promise<Buffer | null>>();
  private goalSets = new Map<string, Goal & any>();
  private versions: string[];

  constructor(private root: string) {
    try { this.versions = JSON.parse(readFileSync(join(root, "goals/index.json"), "utf8")).versions; } catch { this.versions = []; }
  }

  /** The bitmap font, loaded on first use (a site without previews never needs it). */
  private get font() {
    return this.fontLoad ??= sharp(join(this.root, "yab/ascii.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
      const widths = Array.from({ length: 256 }, (_, code) => {
        const cx = (code % 16) * 8, cy = Math.floor(code / 16) * 8;
        for (let x = 7; x >= 0; x--) for (let y = 0; y < 8; y++) if (data[((cy + y) * info.width + cx + x) * 4 + 3] > 0) return x + 1;
        return 0;
      });
      return { px: data, w: info.width, widths };
    });
  }

  private file(rel: string) {
    if (!this.files.has(rel)) this.files.set(rel, sharp(join(this.root, rel)).ensureAlpha().png().toBuffer().catch(() => null));
    return this.files.get(rel)!;
  }

  /** Goal data for a mod version ("2.15.1+mc26.3" → 2.15.1). */
  goals(modVersion: string): { version: string; goals: Record<string, Goal> } {
    const base = modVersion.split(/[+-]/)[0];
    // same rule as the site's goals.ts: that release's data, or the newest we have
    const version = this.versions.includes(base) ? base : this.versions.at(-1) ?? "";
    if (!this.goalSets.has(version)) {
      try { this.goalSets.set(version, JSON.parse(readFileSync(join(this.root, `goals/${version}/goals.json`), "utf8"))); } catch { this.goalSets.set(version, {}); }
    }
    return { version, goals: this.goalSets.get(version) };
  }

  /** Text in the Minecraft font at `scale`, with the mod's 1px drop shadow when `shadow` is a colour. */
  async text(s: string, color: string, scale: number, shadow: string | null = null, maxWidth = Infinity) {
    const { px, w: fw, widths } = await this.font;
    const adv = (ch: string) => (ch === " " ? 4 : widths[ch.charCodeAt(0)] + 1);
    let chars = [...s].map(ch => (ch.charCodeAt(0) < 256 && (ch === " " || widths[ch.charCodeAt(0)]) ? ch : "?"));
    let width = chars.reduce((n, ch) => n + adv(ch), 0) - 1;
    while (width > maxWidth && chars.length) { width -= adv(chars.pop()!); }
    const off = shadow ? 1 : 0, w = Math.max(1, width + off), h = 8 + off;
    const out = Buffer.alloc(w * h * 4);
    const paint = (dx: number, dy: number, c: RGB) => {
      let x = dx;
      for (const ch of chars) {
        const code = ch.charCodeAt(0), cx = (code % 16) * 8, cy = Math.floor(code / 16) * 8;
        if (ch !== " ") for (let y = 0; y < 8; y++) for (let gx = 0; gx < 8; gx++) {
          if (px[((cy + y) * fw + cx + gx) * 4 + 3] === 0) continue;
          const tx = x + gx, ty = y + dy;
          if (tx >= w || ty >= h) continue;
          const o = (ty * w + tx) * 4;
          out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
        }
        x += adv(ch);
      }
    };
    if (shadow) paint(1, 1, rgb(shadow));
    paint(0, 0, rgb(color));
    const input = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).resize(w * scale, h * scale, { kernel: "nearest" }).png().toBuffer();
    return { input, width: w * scale, height: h * scale };
  }

  private async scaled(rel: string, size: number) {
    const buf = await this.file(rel);
    return buf && sharp(buf).resize(size, size, { kernel: "nearest" }).png().toBuffer();
  }

  /** A goal's icon at `size` px, laid out like the site's GoalIcon (stacks for "any of", 2x2 for "all of"). */
  private async icon(goal: Goal | undefined, version: string, size: number, left: number, top: number): Promise<OverlayOptions[]> {
    if (!goal) return [];
    const file = (key: string) => `goals/${version}/icons/${key.replace(/[^a-z0-9_-]/gi, "_")}.png`;
    const one = async (key: string | undefined, s: number, dx: number, dy: number) => {
      const b = key && await this.scaled(file(key), Math.round(s));
      return b ? [{ input: b, left: Math.round(left + dx), top: Math.round(top + dy) }] : [];
    };
    const out: OverlayOptions[] = [];
    if (goal.img) out.push(...await one("img:" + goal.img, size, 0, 0));
    else if (goal.s === "one" && goal.ii) for (const [i, id] of [...goal.ii.slice(0, 3).entries()].reverse()) out.push(...await one(id, size * .75, size * .125 * i, size * .125 * i));
    else if (goal.s === "all" && goal.ii) for (const [i, id] of goal.ii.slice(0, 4).entries()) out.push(...await one(id, size * .5625, (i % 2) * size * .421875, Math.floor(i / 2) * size * .421875));
    else out.push(...await one(goal.i, size, 0, 0));
    if (goal.x) out.push(...await one("deco:forbidden", size * 1.25, -size * .125, -size * .125));
    return out;
  }

  private rect(w: number, h: number, color: string) {
    const [r, g, b] = rgb(color);
    return sharp({ create: { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)), channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
  }

  /** One team's card (122x132 card pixels) at `k` screen px per card pixel, top-left at (x, y). */
  async card(team: MatchTeam, board: Board, opts: { version: string; goals: Record<string, Goal>; modes: string[]; k: number; x: number; y: number; won: boolean }) {
    const { k, x, y } = opts, st = teamStyle(team.id), out: OverlayOptions[] = [];
    const frame = await this.file(st.frame);
    if (frame) out.push({ input: await sharp(frame).resize(122 * k, 132 * k, { kernel: "nearest" }).png().toBuffer(), left: x, top: y });
    const label = await this.text(cardLabel(team.id, team.players), st.text, k, null, 70);
    out.push({ input: label.input, left: x + 12 * k, top: y + 10 * k });
    const lockout = opts.modes.includes("lockout") || opts.modes.includes("draftout");
    for (const cell of board.cells) {
      const tx = x + (12 + 20 * cell.x) * k, ty = y + (22 + 20 * cell.y) * k;
      const got = cell.completedBy.includes(team.id), others = cell.completedBy.some(t => t !== team.id);
      if (got) out.push({ input: await this.rect(18 * k, 18 * k, ACHIEVED), left: tx, top: ty });
      const goal = opts.goals[cell.objectiveId];
      out.push(...await this.icon(goal, opts.version, 16 * k, tx + k, ty + k));
      if (goal && (goal.c === "advancement" || (goal.c === "challenge" && goal.k === "stat"))) {
        const deco = await this.scaled("yab/image_frame_advancement.png", 20 * k);
        if (deco) out.push({ input: deco, left: tx - k, top: ty - k });
      }
      if (lockout && others && !got) {
        const lock = await this.scaled("yab/image_frame_locked.png", 20 * k);
        if (lock) out.push({ input: lock, left: tx - k, top: ty - k });
      }
      if (cell.count && cell.count > 1) {
        // like a stack size: white, shadow #3f3f3f, right edge at the tile's right edge, top at +10
        const n = await this.text(String(cell.count), WHITE, k, "#3f3f3f");
        out.push({ input: n.input, left: tx + 18 * k - (n.width - k), top: ty + 10 * k });
      }
    }
    if (opts.won) {
      const win = await this.text("WINNER!", st.accent, k, "#000000");
      out.push({ input: win.input, left: x + 122 * k - win.width - 2 * k, top: y - 4 * k });
    }
    return out;
  }

  async render(layers: OverlayOptions[]) {
    const [r, g, b] = rgb(BG);
    // clip anything that spills past the edges (sharp refuses overlays outside the canvas)
    const fit: OverlayOptions[] = [];
    for (const l of layers) {
      const meta = await sharp(l.input as Buffer).metadata();
      const left = l.left ?? 0, top = l.top ?? 0, w = meta.width ?? 0, h = meta.height ?? 0;
      const x0 = Math.max(0, left), y0 = Math.max(0, top), x1 = Math.min(W, left + w), y1 = Math.min(H, top + h);
      if (x1 <= x0 || y1 <= y0) continue;
      const input = x0 === left && y0 === top && x1 === left + w && y1 === top + h ? l.input
        : await sharp(l.input as Buffer).extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
      fit.push({ input, left: x0, top: y0 });
    }
    return sharp({ create: { width: W, height: H, channels: 4, background: { r, g, b, alpha: 1 } } }).composite(fit).png().toBuffer();
  }

  /** The site's logo, `h` px tall. */
  async logo(h: number) {
    const buf = await this.file("yab/logo.png");
    if (!buf) return null;
    const m = await sharp(buf).metadata();
    const w = Math.round((m.width! / m.height!) * h);
    return { input: await sharp(buf).resize(w, h).png().toBuffer(), width: w, height: h };
  }
}

// ---- data shapes (what getMatch / leaderboard / playerProfile return, the parts used here) -----------------
export interface MatchTeam { id: string; items: number; lines: number; cards: number; winner: boolean; players: { uuid: string; name: string }[] }
interface Board { id: string; teams: string[]; cells: { x: number; y: number; objectiveId: string; completedBy: string[]; count?: number }[] }
export interface MatchData {
  id: string; modVersion: string; modName?: string | null; endedAt: string; durationMs: number; excluded: boolean; source: string;
  modes?: string[]; teams: MatchTeam[]; boards: Board[];
}

export const clock = (ms: number) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

export async function matchImage(p: Painter, m: MatchData): Promise<Buffer> {
  const layers: OverlayOptions[] = [];
  const { version, goals } = p.goals(m.modVersion);
  const modes = m.modes ?? [];
  const add = (t: { input: Buffer; width: number }, left: number, top: number) => layers.push({ input: t.input, left, top });

  // header: logo, date · length · modes, and who won
  const logo = await p.logo(64);
  if (logo) layers.push({ input: logo.input, left: 40, top: 24 });
  const hx = 40 + (logo?.width ?? 0) + 24;
  const winners = m.teams.filter(t => t.winner);
  const headline = winners.length ? `${winners.map(t => t.players.length === 1 ? t.players[0].name : `${teamName(t.id)} Team`).join(" & ")} wins!` : "No winner";
  add(await p.text(headline, winners.length ? teamStyle(winners[0].id).accent : WHITE, 4, "#000000", (W - hx - 40) / 4), hx, 26);
  const sub = [m.endedAt.slice(0, 10), clock(m.durationMs), ...modes.map(x => modeName(x)), ...(m.modName && m.modName !== "Yet Another Minecraft BINGO" ? [m.modName] : [])].join("  -  ");
  add(await p.text(sub, MUTED, 2, null, (W - hx - 40) / 2), hx, 70);

  const shown = m.teams.filter(t => t.players.length);
  const boardFor = (id: string) => m.boards.find(b => b.teams.includes(id)) ?? m.boards[0];
  if (m.boards.length && shown.length) {
    // the biggest whole scale that fits every card side by side
    const n = shown.length, gap = 40;
    const k = [4, 3, 2, 1].find(s => n * 122 * s + (n - 1) * gap <= W - 80 && 120 + 132 * s + 100 <= H) ?? 1;
    const total = n * 122 * k + (n - 1) * gap, x0 = Math.round((W - total) / 2), y0 = 120;
    for (const [i, t] of shown.entries()) {
      const x = x0 + i * (122 * k + gap);
      layers.push(...await p.card(t, boardFor(t.id), { version, goals, modes, k, x, y: y0, won: t.winner }));
      const score = await p.text(`${t.items} items${t.lines ? ` - ${t.lines} lines` : ""}`, WHITE, 2, "#000000");
      add(score, x + Math.round((122 * k - score.width) / 2), y0 + 132 * k + 12);
      if (t.players.length > 1) {
        const names = await p.text(t.players.map(pl => pl.name).join(", "), MUTED, 2, null, (122 * k) / 2);
        add(names, x + Math.round((122 * k - names.width) / 2), y0 + 132 * k + 40);
      }
    }
  } else {
    // imported from bingo.db: no card, just the teams
    for (const [i, t] of shown.slice(0, 6).entries()) {
      const y = 150 + i * 70, st = teamStyle(t.id);
      const name = await p.text(t.players.map(pl => pl.name).join(", ") || teamName(t.id), st.accent, 4, "#000000", 700 / 4);
      add(name, 80, y);
      add(await p.text(`${t.items} items${t.winner ? "  - WINNER!" : ""}`, WHITE, 3, "#000000"), 820, y + 6);
    }
  }
  add(await p.text("bingo.dyrox.cat", MUTED, 2), W - 40 - 15 * 12, H - 34);
  return p.render(layers);
}

export async function bannerImage(p: Painter, title: string, lines: { text: string; color?: string }[]): Promise<Buffer> {
  const layers: OverlayOptions[] = [];
  const logo = await p.logo(180);
  if (logo) layers.push({ input: logo.input, left: Math.round((W - logo.width) / 2), top: 50 });
  const t = await p.text(title, WHITE, 6, "#000000", (W - 80) / 6);
  layers.push({ input: t.input, left: Math.round((W - t.width) / 2), top: 270 });
  for (const [i, l] of lines.slice(0, 5).entries()) {
    const s = await p.text(l.text, l.color ?? MUTED, 3, "#000000", (W - 80) / 3);
    layers.push({ input: s.input, left: Math.round((W - s.width) / 2), top: 360 + i * 44 });
  }
  const site = await p.text("bingo.dyrox.cat", MUTED, 2);
  layers.push({ input: site.input, left: W - 40 - site.width, top: H - 34 });
  return p.render(layers);
}

/** Short hash for ?v= on image links, so a changed match gets a fresh preview past Discord's cache. */
export const version = (x: unknown) => createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 10);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** index.html with this page's title and link-preview tags. */
export function withMeta(html: string, meta: { title: string; description: string; image: string; url: string; color?: string }) {
  const tags = [
    `<meta property="og:site_name" content="Bingo 对战平台" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    `<meta property="og:image" content="${esc(meta.image)}" />`,
    `<meta property="og:image:width" content="${W}" />`,
    `<meta property="og:image:height" content="${H}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    meta.color ? `<meta name="theme-color" content="${esc(meta.color)}" />` : "",
  ].filter(Boolean).join("\n    ");
  return html.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>\n    ${tags}`);
}
