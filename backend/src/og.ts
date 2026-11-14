import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
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

/** Decoded RGBA pixels. */
interface Img { data: Buffer; w: number; h: number }

/**
 * The picture being drawn: one RGBA buffer that everything is painted into with nearest-neighbour scaling
 * and alpha blending, then encoded once. (A sharp call per icon was ~5 s a picture on the server.)
 */
class Canvas {
  readonly data: Buffer;
  constructor(readonly w: number, readonly h: number, bg: string) {
    this.data = Buffer.alloc(w * h * 4);
    const [r, g, b] = rgb(bg);
    for (let i = 0; i < w * h; i++) { this.data[i * 4] = r; this.data[i * 4 + 1] = g; this.data[i * 4 + 2] = b; this.data[i * 4 + 3] = 255; }
  }

  /** Paints `img` scaled to dw×dh (nearest) at (x, y), over what's there. */
  draw(img: Img | null, x: number, y: number, dw = img?.w ?? 0, dh = img?.h ?? 0) {
    if (!img) return;
    x = Math.round(x); y = Math.round(y); dw = Math.round(dw); dh = Math.round(dh);
    for (let dy = Math.max(0, -y); dy < dh && y + dy < this.h; dy++) {
      const sy = Math.floor((dy * img.h) / dh);
      for (let dx = Math.max(0, -x); dx < dw && x + dx < this.w; dx++) {
        const s = (sy * img.w + Math.floor((dx * img.w) / dw)) * 4, a = img.data[s + 3];
        if (!a) continue;
        const o = ((y + dy) * this.w + x + dx) * 4;
        if (a === 255) { this.data[o] = img.data[s]; this.data[o + 1] = img.data[s + 1]; this.data[o + 2] = img.data[s + 2]; continue; }
        const k = a / 255;
        for (let c = 0; c < 3; c++) this.data[o + c] = Math.round(img.data[s + c] * k + this.data[o + c] * (1 - k));
      }
    }
  }

  fill(x: number, y: number, w: number, h: number, color: string) {
    const [r, g, b] = rgb(color);
    this.draw({ data: Buffer.from([r, g, b, 255]), w: 1, h: 1 }, x, y, w, h);
  }

  png() { return sharp(this.data, { raw: { width: this.w, height: this.h, channels: 4 } }).png().toBuffer(); }
}

/** Text in the Minecraft font at 1 font pixel per pixel; `scale` it when drawing. */
interface Text extends Img {}

/** Loads files from the built site and draws with them; one per server. */
export class Painter {
  private fontLoad: Promise<{ px: Buffer; w: number; widths: number[] }> | null = null;
  private images = new Map<string, Promise<Img | null>>();
  private goalSets = new Map<string, Record<string, Goal>>();
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

  /** A PNG from the site, decoded once; `height` resizes it smoothly (the logo). */
  image(rel: string, height?: number): Promise<Img | null> {
    const key = `${rel}@${height ?? ""}`;
    if (!this.images.has(key)) {
      let s = sharp(join(this.root, rel)).ensureAlpha();
      if (height) s = s.resize({ height });
      this.images.set(key, s.raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => ({ data, w: info.width, h: info.height })).catch(() => null));
    }
    return this.images.get(key)!;
  }

  /** Goal data for a mod version ("2.15.1+mc26.3" → 2.15.1). */
  goals(modVersion: string): { version: string; goals: Record<string, Goal> } {
    const base = modVersion.split(/[+-]/)[0];
    // same rule as the site's goals.ts: that release's data, or the newest we have
    const version = this.versions.includes(base) ? base : this.versions.at(-1) ?? "";
    if (!this.goalSets.has(version)) {
      try { this.goalSets.set(version, JSON.parse(readFileSync(join(this.root, `goals/${version}/goals.json`), "utf8"))); } catch { this.goalSets.set(version, {}); }
    }
    return { version, goals: this.goalSets.get(version)! };
  }

  /** Text in the Minecraft font, with the mod's 1px drop shadow when `shadow` is a colour; cut to `maxWidth` font px. */
  async text(s: string, color: string, shadow: string | null = null, maxWidth = Infinity): Promise<Text> {
    const { px, w: fw, widths } = await this.font;
    const adv = (ch: string) => (ch === " " ? 4 : widths[ch.charCodeAt(0)] + 1);
    const chars = [...s].map(ch => (ch.charCodeAt(0) < 256 && (ch === " " || widths[ch.charCodeAt(0)]) ? ch : "?"));
    let width = chars.reduce((n, ch) => n + adv(ch), 0) - 1;
    while (width > maxWidth && chars.length) width -= adv(chars.pop()!);
    const off = shadow ? 1 : 0, w = Math.max(1, width + off), h = 8 + off;
    const data = Buffer.alloc(w * h * 4);
    const paint = (dx: number, dy: number, c: RGB) => {
      let x = dx;
      for (const ch of chars) {
        const code = ch.charCodeAt(0), cx = (code % 16) * 8, cy = Math.floor(code / 16) * 8;
        if (ch !== " ") for (let y = 0; y < 8; y++) for (let gx = 0; gx < 8; gx++) {
          if (px[((cy + y) * fw + cx + gx) * 4 + 3] === 0) continue;
          const tx = x + gx, ty = y + dy;
          if (tx >= w || ty >= h) continue;
          const o = (ty * w + tx) * 4;
          data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
        }
        x += adv(ch);
      }
    };
    if (shadow) paint(1, 1, rgb(shadow));
    paint(0, 0, rgb(color));
    return { data, w, h };
  }

  /** A goal's icon in a size×size box, laid out like the site's GoalIcon (stacks for "any of", 2x2 for "all of"). */
  private async icon(cv: Canvas, goal: Goal | undefined, version: string, size: number, left: number, top: number) {
    if (!goal) return;
    const file = (key: string) => `goals/${version}/icons/${key.replace(/[^a-z0-9_-]/gi, "_")}.png`;
    const one = async (key: string | undefined, s: number, dx: number, dy: number) => {
      if (key) cv.draw(await this.image(file(key)), left + dx, top + dy, s, s);
    };
    if (goal.img) await one("img:" + goal.img, size, 0, 0);
    else if (goal.s === "one" && goal.ii) for (const [i, id] of [...goal.ii.slice(0, 3).entries()].reverse()) await one(id, size * .75, size * .125 * i, size * .125 * i);
    else if (goal.s === "all" && goal.ii) for (const [i, id] of goal.ii.slice(0, 4).entries()) await one(id, size * .5625, (i % 2) * size * .421875, Math.floor(i / 2) * size * .421875);
    else await one(goal.i, size, 0, 0);
    if (goal.x) await one("deco:forbidden", size * 1.25, -size * .125, -size * .125);
  }

  /** One team's card (122x132 card pixels) at `k` px per card pixel, top-left at (x, y). */
  async card(cv: Canvas, team: MatchTeam, board: Board, opts: { version: string; goals: Record<string, Goal>; modes: string[]; k: number; x: number; y: number; won: boolean }) {
    const { k, x, y } = opts, st = teamStyle(team.id);
    cv.draw(await this.image(st.frame), x, y, 122 * k, 132 * k);
    const label = await this.text(cardLabel(team.id, team.players), st.text, null, 70);
    cv.draw(label, x + 12 * k, y + 10 * k, label.w * k, label.h * k);
    const lockout = opts.modes.includes("lockout") || opts.modes.includes("draftout");
    const star = await this.image("yab/image_frame_advancement.png"), lock = await this.image("yab/image_frame_locked.png");
    for (const cell of board.cells) {
      const tx = x + (12 + 20 * cell.x) * k, ty = y + (22 + 20 * cell.y) * k;
      const got = cell.completedBy.includes(team.id), others = cell.completedBy.some(t => t !== team.id);
      if (got) cv.fill(tx, ty, 18 * k, 18 * k, ACHIEVED);
      const goal = opts.goals[cell.objectiveId];
      await this.icon(cv, goal, opts.version, 16 * k, tx + k, ty + k);
      if (goal && (goal.c === "advancement" || (goal.c === "challenge" && goal.k === "stat"))) cv.draw(star, tx - k, ty - k, 20 * k, 20 * k);
      if (lockout && others && !got) cv.draw(lock, tx - k, ty - k, 20 * k, 20 * k);
      if (cell.count && cell.count > 1) {
        // like a stack size: white, shadow #3f3f3f, right edge at the tile's right edge, top at +10
        const n = await this.text(String(cell.count), WHITE, "#3f3f3f");
        cv.draw(n, tx + 18 * k - (n.w - 1) * k, ty + 10 * k, n.w * k, n.h * k);
      }
    }
    if (opts.won) {
      const win = await this.text("WINNER!", st.accent, "#000000");
      cv.draw(win, x + 122 * k - win.w * k - 2 * k, y - 4 * k, win.w * k, win.h * k);
    }
  }

  /** Text at `scale`; `align` places (x, y) at its left, centre or right. */
  async write(cv: Canvas, s: string, x: number, y: number, o: { color?: string; scale?: number; shadow?: string | null; maxWidth?: number; align?: "left" | "center" | "right" } = {}) {
    const scale = o.scale ?? 2, t = await this.text(s, o.color ?? WHITE, o.shadow ?? null, (o.maxWidth ?? Infinity) / scale);
    const w = t.w * scale;
    cv.draw(t, o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x, y, w, t.h * scale);
    return w;
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
  const cv = new Canvas(W, H, BG);
  const { version, goals } = p.goals(m.modVersion);
  const modes = m.modes ?? [];

  // header: logo, who won, then date · length · modes
  const logo = await p.image("yab/logo.png", 64);
  cv.draw(logo, 40, 24);
  const hx = 40 + (logo?.w ?? 0) + 24;
  const winners = m.teams.filter(t => t.winner);
  const headline = winners.length ? `${winners.map(t => t.players.length === 1 ? t.players[0].name : `${teamName(t.id)} Team`).join(" & ")} wins!` : "No winner";
  await p.write(cv, headline, hx, 26, { color: winners.length ? teamStyle(winners[0].id).accent : WHITE, scale: 4, shadow: "#000000", maxWidth: W - hx - 40 });
  const sub = [m.endedAt.slice(0, 10), clock(m.durationMs), ...modes.map(x => modeName(x)), ...(m.modName && m.modName !== "Yet Another Minecraft BINGO" ? [m.modName] : [])];
  await p.write(cv, sub.join("  -  "), hx, 70, { color: MUTED, maxWidth: W - hx - 40 });

  const shown = m.teams.filter(t => t.players.length);
  const boardFor = (id: string) => m.boards.find(b => b.teams.includes(id)) ?? m.boards[0];
  if (m.boards.length && shown.length) {
    // the biggest whole scale that fits every card side by side
    const n = shown.length, gap = 40;
    const k = [4, 3, 2, 1].find(s => n * 122 * s + (n - 1) * gap <= W - 80 && 120 + 132 * s + 100 <= H) ?? 1;
    const total = n * 122 * k + (n - 1) * gap, x0 = Math.round((W - total) / 2), y0 = 120;
    for (const [i, t] of shown.entries()) {
      const x = x0 + i * (122 * k + gap), mid = x + (122 * k) / 2;
      await p.card(cv, t, boardFor(t.id), { version, goals, modes, k, x, y: y0, won: t.winner });
      await p.write(cv, `${t.items} items${t.lines ? ` - ${t.lines} lines` : ""}`, mid, y0 + 132 * k + 12, { shadow: "#000000", align: "center" });
      if (t.players.length > 1) await p.write(cv, t.players.map(pl => pl.name).join(", "), mid, y0 + 132 * k + 40, { color: MUTED, align: "center", maxWidth: 122 * k });
    }
  } else {
    // imported from bingo.db: no card, just the teams
    for (const [i, t] of shown.slice(0, 6).entries()) {
      const y = 150 + i * 70;
      await p.write(cv, t.players.map(pl => pl.name).join(", ") || teamName(t.id), 80, y, { color: teamStyle(t.id).accent, scale: 4, shadow: "#000000", maxWidth: 700 });
      await p.write(cv, `${t.items} items${t.winner ? "  - WINNER!" : ""}`, 820, y + 6, { scale: 3, shadow: "#000000" });
    }
  }
  await p.write(cv, "bingo.dyrox.cat", W - 40, H - 34, { color: MUTED, align: "right" });
  return cv.png();
}

export async function bannerImage(p: Painter, title: string, lines: { text: string; color?: string }[]): Promise<Buffer> {
  const cv = new Canvas(W, H, BG);
  const logo = await p.image("yab/logo.png", 180);
  if (logo) cv.draw(logo, Math.round((W - logo.w) / 2), 50);
  await p.write(cv, title, W / 2, 270, { scale: 6, shadow: "#000000", align: "center", maxWidth: W - 80 });
  for (const [i, l] of lines.slice(0, 5).entries()) {
    await p.write(cv, l.text, W / 2, 360 + i * 44, { color: l.color ?? MUTED, scale: 3, shadow: "#000000", align: "center", maxWidth: W - 80 });
  }
  await p.write(cv, "bingo.dyrox.cat", W - 40, H - 34, { color: MUTED, align: "right" });
  return cv.png();
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
