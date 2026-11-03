// Reading and editing YAB's own config files in the browser, for the ban editor.
// config/yet-another-minecraft-bingo/config.json is JSON with // comments, so it's edited as text: only the
// itemFilterPresets block changes and every comment and blank line stays where it was.
// tags/banned.json is a plain tag file: { "values": ["minecraft:dirt", "#some:tag", ...] }.

export const PRESET = 'exclude banned';
export const TAG = 'banned';
const DEFAULT_BASE = '-tedious -unobtainable';

type Tok = { kind: 'str'; start: number; end: number; value: string } | { kind: 'punct'; at: number; ch: string };

/** Strings and punctuation outside comments, with their positions in the text. */
function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; continue; }
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out.push({ kind: 'str', start, end: i + 1, value: JSON.parse(text.slice(start, i + 1)) });
      continue;
    }
    if ('{}[]:,'.includes(c)) out.push({ kind: 'punct', at: i, ch: c });
  }
  return out;
}

/** JSON with // and /* comments (and trailing commas) → value. Throws if it isn't. */
export function parseJsonc(text: string): any {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? text.length : e + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

export interface ConfigInfo {
  /** the "exclude banned" preset as it is in the file, if any */
  existing: string | null;
  /** what the preset will be: the existing one, or "everything" (or YAB's default) plus -banned */
  filter: string;
}

export function readConfig(text: string): ConfigInfo {
  const o = parseJsonc(text);
  const presets: Record<string, unknown> = o?.itemFilterPresets ?? {};
  const existing = typeof presets[PRESET] === 'string' ? presets[PRESET] as string : null;
  const base = typeof presets.everything === 'string' ? presets.everything : DEFAULT_BASE;
  const filter = existing ?? (base.split(/\s+/).includes(`-${TAG}`) ? base : `${base} -${TAG}`.trim());
  return { existing, filter };
}

/** Is this YAB's config.json? (it has the filter presets, or at least YAB's other config keys) */
export const looksLikeConfig = (o: any) => !!o && typeof o === 'object' && ('itemFilterPresets' in o || 'difficultyPresets' in o);
/** Is this a tag file like banned.json? */
export const looksLikeTag = (o: any) => !!o && typeof o === 'object' && Array.isArray(o.values);

/** The config text with the "exclude banned" preset in it; nothing else is touched. */
export function withPreset(text: string, filter: string): string {
  const toks = tokens(text);
  const entry = `${JSON.stringify(PRESET)}: ${JSON.stringify(filter)}`;
  const at = toks.findIndex((t, i) => t.kind === 'str' && t.value === 'itemFilterPresets'
    && toks[i + 1]?.kind === 'punct' && (toks[i + 1] as any).ch === ':' && toks[i + 2]?.kind === 'punct' && (toks[i + 2] as any).ch === '{');
  if (at < 0) {
    // no presets block: add one right after the opening brace
    const open = toks.find(t => t.kind === 'punct' && t.ch === '{') as Extract<Tok, { kind: 'punct' }>;
    const block = `\n    "itemFilterPresets": {\n        ${entry}\n    },`;
    return text.slice(0, open.at + 1) + block + text.slice(open.at + 1);
  }
  const open = toks[at + 2] as Extract<Tok, { kind: 'punct' }>;
  // the block's own tokens, up to its closing brace
  let depth = 0, end = at + 2;
  for (let i = at + 2; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === 'punct' && (t.ch === '{' || t.ch === '[')) depth++;
    if (t.kind === 'punct' && (t.ch === '}' || t.ch === ']')) depth--;
    if (depth === 0) { end = i; break; }
  }
  const inner = toks.slice(at + 3, end);
  const key = inner.findIndex((t, i) => t.kind === 'str' && t.value === PRESET && inner[i + 1]?.kind === 'punct' && inner[i + 2]?.kind === 'str');
  if (key >= 0) {
    const v = inner[key + 2] as Extract<Tok, { kind: 'str' }>;
    return text.slice(0, v.start) + JSON.stringify(filter) + text.slice(v.end);
  }
  // new entry first in the block, indented like the next line
  const after = text.slice(open.at + 1);
  const indent = /\n([ \t]*)\S/.exec(after)?.[1] ?? '        ';
  const empty = !inner.length;
  return text.slice(0, open.at + 1) + `\n${indent}${entry}${empty ? '' : ','}` + after;
}

export const tagFile = (values: string[]) => JSON.stringify({ values }, null, 4) + '\n';

/** Hands the browser a file to save. */
export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
