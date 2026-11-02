import { useEffect, useMemo, useRef, useState } from 'react';
import { GoalIcon } from '../components/GoalIcon';
import { Status } from '../components/Layout';
import { useGoals, type Goal } from '../goals';
import { getGoalStats, type GoalStat } from '../api';
import { clock } from '../components/Timeline';
import { useLang } from '../i18n';

// The tier guide, part of the site (it began as a standalone page).
// Same rules: the simplified board has its own pool, tiers and exclusive groups, and only changes item goals.

const TIERS = ['S', 'A', 'B', 'C', 'D'] as const;
type Entry = Goal & { id: string };
type Board = 'all' | 'normal' | 'simplified';
type Sort = 'default' | 'seen' | 'rate' | 'fast';
type Filter = { c: string; tiers: string[]; board: Board; sort?: Sort };

const KEY = 'bingo-guide-filter';
const readFilter = (): Filter => {
  try { const f = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (f?.tiers) return f; } catch { /* private mode */ }
  return { c: 'all', tiers: [...TIERS], board: 'all' };
};

/** "N 选 1" tag whose popup lists the whole group; flips right if it would leave the screen. */
function GroupTag({ e, mates, tierOf }: { e: Entry; mates: Entry[]; tierOf: (x: Entry) => string | undefined }) {
  const { lang, t } = useLang();
  const tip = useRef<HTMLSpanElement>(null);
  const place = () => {
    const el = tip.current;
    if (!el) return;
    el.classList.remove('flip');
    if (el.getBoundingClientRect().left < 8) el.classList.add('flip');
  };
  return (
    <span className="gd-tag grp" tabIndex={0} onMouseEnter={place} onFocus={place}>
      {t.guide.grp(mates.length)}
      <span className="gd-tip" role="tooltip" ref={tip}>
        <span className="h">{t.guide.grpTip}</span>
        {mates.map(x => (
          <span key={x.id} className={'m' + (x === e ? ' me' : '')}>
            <b style={{ color: `var(--t${tierOf(x)})` }}>{tierOf(x)}</b>{lang === 'zh' ? x.z ?? x.n : x.n}
          </span>
        ))}
      </span>
    </span>
  );
}

export function GuidePage() {
  const { lang, t } = useLang();
  const T = t.guide;
  const data = useGoals('latest');
  // how each goal has gone in real matches on this site; the guide works without it
  const [stats, setStats] = useState<Record<string, GoalStat>>({});
  useEffect(() => { getGoalStats().then(setStats).catch(() => {}); }, []);
  const [f, setF] = useState<Filter>(readFilter);
  const [q, setQ] = useState('');
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* private mode */ } }, [f]);

  const list = useMemo<Entry[]>(() => Object.entries(data?.goals ?? {}).map(([id, g]) => ({ id, ...g })), [data]);
  const groups = useMemo(() => {
    const g = new Map<string, Entry[]>(), sg = new Map<string, Entry[]>();
    for (const e of list) {
      if (e.g) g.set(e.g, [...(g.get(e.g) ?? []), e]);
      if (e.sg) sg.set(e.sg, [...(sg.get(e.sg) ?? []), e]);
    }
    return { g, sg };
  }, [list]);

  if (!data) return <Status>{t.loading}</Status>;

  const simple = f.board === 'simplified';
  const onBoard = (e: Entry) => e.c !== 'item' || f.board === 'all' || (simple ? !!e.st : !e.sm);
  const tierOf = (e: Entry) => (simple && e.c === 'item' ? e.st : e.t);
  const needle = q.trim().toLowerCase();
  const match = (e: Entry) => onBoard(e)
    && (f.c === 'all' || (f.c === 'star' ? e.c !== 'item' : e.c === f.c))
    && (!needle || [e.n, e.z, e.d, e.zd, e.id].some(v => v?.toLowerCase().includes(needle)));
  const toggleTier = (tier: string) => setF(p => {
    const tiers = p.tiers.includes(tier) ? p.tiers.filter(x => x !== tier) : [...p.tiers, tier];
    return { ...p, tiers: tiers.length ? tiers : [...TIERS] };
  });

  const card = (e: Entry) => {
    const zhFirst = lang === 'zh' && e.z;
    const main = zhFirst ? e.z : e.n, alt = zhFirst ? e.n : e.z;
    const mates = simple && e.c === 'item' ? (e.sg ? groups.sg.get(e.sg) ?? [] : []) : (e.g ? groups.g.get(e.g) ?? [] : []);
    const grp = mates.length > 1 ? <GroupTag e={e} mates={mates} tierOf={tierOf} /> : null;
    const sm = e.sm && !simple ? <span className="gd-tag" title={T.smTip}>{T.sm}</span>
      : simple && e.st && !e.sm && e.st !== e.t ? <span className="gd-tag">{T.was(e.t)}</span> : null;
    const icon = <GoalIcon goal={e} version={data.version} size={e.c === 'item' ? 28 : 36} />;
    const st = stats[e.id];
    const statLine = st && st.appearances > 0 && (
      <span className="gd-stat">{t.goalStat(st.appearances, Math.round((st.completions / st.appearances) * 100), st.avgMs === null ? null : clock(st.avgMs))}</span>
    );
    if (e.c === 'item') {
      return (
        <div key={e.id} className="gd-card" title={e.id}>
          {icon}
          <span className="gd-name">{main}{alt && <span className="gd-alt"> {alt}</span>}{statLine}</span>
          {sm}{grp}
        </div>
      );
    }
    const desc = lang === 'zh' ? e.zd ?? e.d : e.d ?? e.zd;
    const sub = e.c === 'advancement' ? T.adv[e.k ?? ''] : T.kind[e.k ?? ''];
    return (
      <div key={e.id} className="gd-card star" title={e.id}>
        {icon}
        <div className="gd-body">
          <div className="gd-name">{main}</div>
          {alt && <div className="gd-alt">{alt}</div>}
          {desc && <div className="gd-desc">{desc}</div>}
          {statLine}
          <div className="gd-tags">
            <span className="gd-tag">{T.catTag[e.c]}</span>
            {sub && <span className="gd-tag">{sub}</span>}
            {grp}
          </div>
        </div>
      </div>
    );
  };

  let total = 0;
  const sections = TIERS.filter(tier => f.tiers.includes(tier)).map(tier => {
    const rows = list.filter(e => tierOf(e) === tier && match(e));
    // within a tier: by how the goal has gone in real matches; goals never seen keep their order at the end
    const key = (e: Entry) => {
      const s = stats[e.id];
      if (!s?.appearances) return null;
      return f.sort === 'seen' ? -s.appearances : f.sort === 'rate' ? -s.completions / s.appearances : f.sort === 'fast' ? s.avgMs : null;
    };
    if (f.sort && f.sort !== 'default') rows.sort((a, b) => {
      const x = key(a), y = key(b);
      return x === null ? (y === null ? 0 : 1) : y === null ? -1 : x - y;
    });
    total += rows.length;
    if (!rows.length) return null;
    const adv = rows.filter(e => e.c === 'advancement'), ch = rows.filter(e => e.c === 'challenge'), it = rows.filter(e => e.c === 'item');
    const block = (label: string, items: Entry[], cls: string) => items.length > 0 && (
      <>
        <div className="gd-sublabel">{label} · {items.length}</div>
        <div className={'gd-grid ' + cls}>{items.map(card)}</div>
      </>
    );
    return (
      <section key={tier} className="gd-tier" style={{ '--tc': `var(--t${tier})` } as React.CSSProperties}>
        <div className="gd-tier-head"><span className="gd-letter">{tier}</span><span className="muted">{T.meta(rows.length, adv.length + ch.length)}</span></div>
        {block(T.advLabel, adv, '')}{block(T.chLabel, ch, '')}{block(T.itemLabel, it, 'items')}
      </section>
    );
  });

  const seg = <V extends string>(value: V, options: [V, string, string?][], set: (v: V) => void) => (
    <div className="seg">
      {options.map(([v, label, tip]) => <button key={v} aria-pressed={value === v} title={tip} onClick={() => set(v)}>{label}</button>)}
    </div>
  );

  return (
    <>
      <h1>{T.title}</h1>
      <p className="muted gd-sub">{T.sub}</p>
      <div className="gd-summary">
        {TIERS.map(tier => {
          const all = list.filter(e => onBoard(e) && tierOf(e) === tier);
          return <span key={tier} className="gd-sum" style={{ '--tc': `var(--t${tier})` } as React.CSSProperties}><b>{tier}</b>{T.sum(all.length, all.filter(e => e.c !== 'item').length)}</span>;
        })}
      </div>

      <div className="gd-bar">
        {seg(f.c, [['all', T.all], ['star', T.star], ['item', T.item], ['advancement', T.advancement], ['challenge', T.challenge]], c => setF(p => ({ ...p, c })))}
        {seg(f.board, [['all', T.bAll, T.bTip.all], ['normal', T.bNormal, T.bTip.normal], ['simplified', T.bSimple, T.bTip.simplified]], board => setF(p => ({ ...p, board })))}
        <div className="seg">
          {TIERS.map(tier => (
            <button key={tier} className="gd-tierbtn" style={{ '--tc': `var(--t${tier})` } as React.CSSProperties}
              aria-pressed={f.tiers.includes(tier)} onClick={() => toggleTier(tier)}>{tier}</button>
          ))}
        </div>
        <select className="gd-sort" value={f.sort ?? 'default'} aria-label={T.sortLabel} onChange={e => setF(p => ({ ...p, sort: e.target.value as Sort }))}>
          {(['default', 'seen', 'rate', 'fast'] as const).map(k => <option key={k} value={k}>{T.sort[k]}</option>)}
        </select>
        <input className="gd-search" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={T.search} />
        <span className="muted gd-count">{T.count(total, list.filter(onBoard).length)}</span>
      </div>

      {total ? sections : <p className="status">{T.empty}</p>}
      <p className="muted small gd-footer">{T.footer}</p>
    </>
  );
}
