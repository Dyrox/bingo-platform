import { useEffect, useMemo, useRef, useState } from 'react';
import { GoalIcon } from '../components/GoalIcon';
import { useGoals } from '../goals';
import { useLang } from '../i18n';
import { download, looksLikeConfig, looksLikeTag, parseJsonc, PRESET, readConfig, tagFile, withPreset } from '../yabconfig';
import { GuidePage } from './GuidePage';

// Custom bans: pick goals in the tier guide, get YAB's tags/banned.json plus a config.json whose filter
// presets include "exclude banned". Everything stays in this browser; nothing is uploaded.

const KEY = 'bingo-bans';
interface Saved { banned: string[]; others: string[]; config: { name: string; text: string } | null }
const load = (): Saved => {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (Array.isArray(s?.banned)) return { others: [], config: null, ...s }; } catch { /* private mode */ }
  return { banned: [], others: [], config: null };
};

export function BansPage() {
  const { lang, t } = useLang();
  const B = t.bans;
  const data = useGoals('latest');
  const [saved, setSaved] = useState<Saved>(load);
  const [notes, setNotes] = useState<{ ok: boolean; text: string }[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode */ } }, [saved]);

  // a tag file read before the goal list arrived: move the entries the guide knows over to the picks
  useEffect(() => {
    if (!data || !saved.others.some(v => data.goals[v])) return;
    setSaved(s => ({ ...s, banned: [...s.banned, ...s.others.filter(v => data.goals[v])], others: s.others.filter(v => !data.goals[v]) }));
  }, [data, saved.others]);

  const banned = useMemo(() => new Set(saved.banned), [saved.banned]);
  const toggle = (id: string) => setSaved(s => ({ ...s, banned: banned.has(id) ? s.banned.filter(x => x !== id) : [...s.banned, id] }));
  const cfg = useMemo(() => {
    if (!saved.config) return null;
    try { return readConfig(saved.config.text); } catch { return null; }
  }, [saved.config]);

  const read = async (files: FileList | File[]) => {
    const out: { ok: boolean; text: string }[] = [];
    for (const file of Array.from(files)) {
      const text = await file.text();
      let o: unknown;
      try { o = parseJsonc(text); } catch { out.push({ ok: false, text: B.badJson(file.name) }); continue; }
      if (looksLikeConfig(o)) {
        setSaved(s => ({ ...s, config: { name: file.name, text } }));
        out.push({ ok: true, text: B.loadedConfig(file.name) });
      } else if (looksLikeTag(o)) {
        // goals the guide knows become picks; anything else (other tags "#…", modded ids) is kept as is
        const values = (o as { values: unknown[] }).values.filter((v): v is string => typeof v === 'string');
        const known = values.filter(v => data?.goals[v]), others = values.filter(v => !data?.goals[v]);
        setSaved(s => ({ ...s, banned: known, others }));
        out.push({ ok: true, text: B.loadedTag(file.name, known.length, others.length) });
      } else out.push({ ok: false, text: B.notRecognized(file.name) });
    }
    setNotes(out);
  };

  const values = [...saved.banned, ...saved.others];
  const name = (id: string) => {
    const g = data?.goals[id];
    return g ? (lang === 'zh' ? g.z ?? g.n : g.n) : id;
  };
  const presetLine = `"${PRESET}": "${cfg?.filter ?? '-tedious -unobtainable -banned'}",`;

  return (
    <>
      <h1>{B.title}</h1>
      <p className="muted gd-sub">{B.sub}</p>

      <div className={'drop' + (over ? ' over' : '')} role="button" tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); read(e.dataTransfer.files); }}>
        <b>{B.drop}</b>
        <span className="muted small">{B.dropHint}</span>
        <input ref={input} type="file" accept=".json,application/json" multiple hidden onChange={e => { if (e.target.files) read(e.target.files); e.target.value = ''; }} />
      </div>
      {notes.map((n, i) => <p key={i} className={'small ' + (n.ok ? 'ok-note' : 'err-note')}>{n.ok ? '✔' : '✘'} {n.text}</p>)}

      <section className="panel bans-panel">
        <div className="bans-head">
          <h2>{B.count(saved.banned.length)}</h2>
          <span className="bans-actions">
            <button className="pill" onClick={() => download('banned.json', tagFile(values))}>{B.dlTag}</button>
            <button className="pill" disabled={!saved.config || !cfg}
              onClick={() => saved.config && cfg && download('config.json', withPreset(saved.config.text, cfg.filter))}>{B.dlConfig}</button>
            {saved.banned.length > 0 && <button className="pill small danger" onClick={() => window.confirm(B.clearConfirm) && setSaved(s => ({ ...s, banned: [] }))}>{B.clear}</button>}
          </span>
        </div>
        {saved.banned.length > 0 && (
          <div className="bans-chips">
            {saved.banned.map(id => (
              <button key={id} className="ban-chip" title={`${id} · ${B.remove}`} onClick={() => toggle(id)}>
                {data && <GoalIcon goal={data.goals[id]} version={data.version} size={18} />}{name(id)} <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        )}
        {saved.others.length > 0 && (
          <>
            <div className="muted small">{B.others}</div>
            <div className="bans-chips">
              {saved.others.map(v => (
                <button key={v} className="ban-chip other" title={B.remove} onClick={() => setSaved(s => ({ ...s, others: s.others.filter(x => x !== v) }))}>
                  <code>{v}</code> <span aria-hidden>×</span>
                </button>
              ))}
            </div>
          </>
        )}
        <p className="small">
          {!saved.config ? <>{B.cfgNone} <code className="mono">{presetLine}</code></>
            : cfg?.existing ? B.cfgHas(cfg.existing) : cfg ? B.cfgAdd(cfg.filter) : B.badJson(saved.config.name)}
        </p>
        <p className="muted small">{B.steps}</p>
      </section>

      <GuidePage pick={{ picked: banned, toggle, label: B.mark }} />
    </>
  );
}
