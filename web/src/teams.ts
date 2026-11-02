import type { Lang } from './i18n';
import cardColors from './card_colors.json';

// YAB team ids are "bingo_<colour>". The mod picks a card frame and text colour per team from
// assets/yet-another-minecraft-bingo/gui/card_colors.json (copied to src/card_colors.json);
// teams it has no frame for get the gray "preview" card, same as in game.
type CardStyle = { backgroundColor: string; textColor: string; outlineColor: string };
const CARDS = cardColors.teams as Record<string, CardStyle>;

// a few Minecraft chat colours go by another name in the mod's card set
const ALIAS: Record<string, string> = { gold: 'orange', light_purple: 'pink', dark_aqua: 'aqua', dark_blue: 'blue', dark_green: 'green', dark_red: 'red', dark_gray: 'gray', white: 'gray' };

const key = (id: string) => id.replace(/^bingo_/, '');
const cardKey = (id: string) => {
  const k = ALIAS[key(id)] ?? key(id);
  return CARDS[k] ? k : 'preview';
};

/** "#aarrggbb" (Minecraft order) → CSS colour. */
const argb = (hex: string) => {
  const h = hex.replace('#', '');
  return h.length === 8 ? `#${h.slice(2)}${h.slice(0, 2)}` : `#${h}`;
};

export function cardStyle(teamId: string) {
  const k = cardKey(teamId);
  const c = CARDS[k];
  return {
    frame: `/yab/card_${k}.png`,
    text: argb(c.textColor),
    // the preview card has a transparent outline; fall back to its text colour for accents
    accent: k === 'preview' ? argb(CARDS.gray.outlineColor) : argb(c.outlineColor),
  };
}

const NAMES: Record<string, { zh: string; en: string }> = {
  red: { zh: '红队', en: 'Red' }, orange: { zh: '橙队', en: 'Orange' }, gold: { zh: '橙队', en: 'Orange' },
  yellow: { zh: '黄队', en: 'Yellow' }, green: { zh: '绿队', en: 'Green' }, aqua: { zh: '青队', en: 'Aqua' },
  blue: { zh: '蓝队', en: 'Blue' }, pink: { zh: '粉队', en: 'Pink' }, light_purple: { zh: '粉队', en: 'Pink' },
  purple: { zh: '紫队', en: 'Purple' }, gray: { zh: '灰队', en: 'Gray' }, white: { zh: '白队', en: 'White' },
  black: { zh: '黑队', en: 'Black' },
  // added by the bingo.db import for a round some other team won, when the file only knew its own team
  unknown: { zh: '其他队伍', en: 'Other team' },
};

export const teamColor = (id: string) => cardStyle(id).accent;

export function teamName(id: string, lang: Lang) {
  const t = NAMES[key(id)];
  if (t) return t[lang];
  const label = key(id).replace(/_/g, ' ');
  return lang === 'zh' ? `${label} 队` : label.replace(/\b\w/g, c => c.toUpperCase());
}

/** What the mod writes on the card: the player's name for a one-player team, otherwise "<Colour> Team". */
export function cardLabel(id: string, players: { name: string }[]) {
  return players.length === 1 ? players[0].name : `${teamName(id, 'en')} Team`;
}
