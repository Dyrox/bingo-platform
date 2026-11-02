import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { bulkMatches, listMatches, type MatchFilter, type MatchSummary } from '../api';
import { useAccount } from '../account';
import { announceMatchesChanged, useMatchesVersion } from '../changes';
import { Status } from '../components/Layout';
import { MatchRow } from '../components/MatchRow';
import { useLang } from '../i18n';

interface Selection { ids: Set<string>; toggle: (all: MatchSummary[], i: number, range: boolean) => void }

/** Paged list of matches; reused by the player page with `player` set. */
export function MatchFeed({ player, filter = {}, selection, onLoad }: {
  player?: string; filter?: MatchFilter; selection?: Selection; onLoad?: (all: MatchSummary[]) => void;
}) {
  const { t } = useLang();
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const version = useMatchesVersion();
  const key = JSON.stringify(filter);

  useEffect(() => {
    let live = true;
    setError(false);
    listMatches({ player, ...filter }).then(p => {
      if (!live) return;
      setMatches(p.matches); setNext(p.next); onLoad?.(p.matches);
    }).catch(() => live && setError(true));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, key, version]);

  const more = async () => {
    if (!next || !matches) return;
    setBusy(true);
    try {
      const p = await listMatches({ player, before: next, ...filter });
      const all = [...matches, ...p.matches];
      setMatches(all); setNext(p.next); onLoad?.(all);
    } catch { setError(true); } finally { setBusy(false); }
  };

  if (error && !matches) return <Status>{t.error}</Status>;
  if (!matches) return <Status>{t.loading}</Status>;
  if (!matches.length) return <Status>{t.none}</Status>;
  return (
    <>
      <div className="match-list">
        {matches.map((m, i) => <MatchRow key={m.id} m={m} highlight={player}
          selected={selection?.ids.has(m.id)} onSelect={selection && (e => selection.toggle(matches, i, e.shiftKey))} />)}
      </div>
      {next && <button className="more" onClick={more} disabled={busy}>{busy ? t.loading : t.loadMore}</button>}
    </>
  );
}

// filters live in the address (?dmin=5&pmin=2) so a filtered list survives a reload
const num = (v: string | null) => v === null || v.trim() === '' || isNaN(+v) ? undefined : +v;

export function MatchList() {
  const { t } = useLang();
  const F = t.filter;
  const { account } = useAccount();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(() => Object.fromEntries(['dmin', 'dmax', 'pmin', 'pmax'].map(k => [k, params.get(k) ?? ''])));
  const [selecting, setSelecting] = useState(false);
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<MatchSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const last = useRef<number | null>(null);

  // typing updates the address after a pause, which refetches
  useEffect(() => {
    const id = setTimeout(() => setParams(Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== '')), { replace: true }), 350);
    return () => clearTimeout(id);
  }, [form, setParams]);

  const minutes = (k: string) => { const v = num(params.get(k)); return v === undefined ? undefined : Math.round(v * 60_000); };
  const filter: MatchFilter = {
    minDurationMs: minutes('dmin'), maxDurationMs: minutes('dmax'),
    minPlayers: num(params.get('pmin')), maxPlayers: num(params.get('pmax')),
  };
  const filtered = Object.values(form).some(v => v.trim() !== '');

  const selection: Selection = {
    ids,
    toggle: (all, i, range) => {
      const s = new Set(ids);
      const on = !s.has(all[i].id);
      const from = range && last.current !== null ? Math.min(last.current, i) : i;
      const to = range && last.current !== null ? Math.max(last.current, i) : i;
      for (let n = from; n <= to && n < all.length; n++) on ? s.add(all[n].id) : s.delete(all[n].id);
      last.current = i;
      setIds(s);
    },
  };

  const act = async (action: 'exclude' | 'include' | 'delete') => {
    if (!ids.size) return;
    if (action === 'delete' && !window.confirm(F.confirm(ids.size))) return;
    setBusy(true); setNote(null);
    try {
      const r = await bulkMatches([...ids], action);
      setNote(F.result(r.done, r.skipped));
      setIds(new Set()); last.current = null;
      announceMatchesChanged();
    } catch { setNote(t.error); } finally { setBusy(false); }
  };

  const field = (k: string, ph: string) => (
    <input type="number" min={0} inputMode="numeric" value={form[k]} placeholder={ph}
      onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
  );

  return (
    <>
      <h1>{t.allMatches}</h1>
      <div className="match-filters">
        <label>{F.duration} {field('dmin', F.min)} – {field('dmax', F.max)} {F.minutes}</label>
        <label>{F.players} {field('pmin', F.min)} – {field('pmax', F.max)}</label>
        {filtered && <button className="pill small" onClick={() => setForm({ dmin: '', dmax: '', pmin: '', pmax: '' })}>{F.clear}</button>}
        {account?.user && (
          <button className={'pill small select-toggle' + (selecting ? ' on' : '')}
            onClick={() => { setSelecting(!selecting); setIds(new Set()); setNote(null); last.current = null; }}>
            {selecting ? F.done : F.select}
          </button>
        )}
      </div>
      {selecting && (
        <div className="bulk-bar">
          <b>{F.selected(ids.size)}</b>
          <button className="pill small" onClick={() => setIds(new Set(loaded.map(m => m.id)))}>{F.all}</button>
          {ids.size > 0 && <button className="pill small" onClick={() => { setIds(new Set()); last.current = null; }}>{F.none}</button>}
          <span className="bulk-actions">
            <button className="pill small" disabled={busy || !ids.size} onClick={() => act('exclude')}>{F.exclude}</button>
            <button className="pill small" disabled={busy || !ids.size} onClick={() => act('include')}>{F.include}</button>
            <button className="pill small danger" disabled={busy || !ids.size} onClick={() => act('delete')}>{F.delete}</button>
          </span>
          <span className="muted small">{note ?? F.hint}</span>
        </div>
      )}
      <MatchFeed filter={filter} selection={selecting ? selection : undefined} onLoad={setLoaded} />
    </>
  );
}
