import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { PlayerProfile } from '../api';
import { formatDate } from '../format';
import { plural, useLang } from '../i18n';

const H = 200, PAD = { l: 30, r: 34, t: 12, b: 24 };

/** Ceiling to a clean axis maximum: 5, 10, 15, 20, 25… */
const niceMax = (v: number) => Math.max(5, Math.ceil(v / 5) * 5);

/** Items per game, one point per match in order played. Hover for the match, click to open it. */
export function ItemsChart({ history }: { history: PlayerProfile['history'] }) {
  const { lang, t } = useLang();
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (history.length < 2) return <p className="muted">{history.length ? `${history[0].items} ${plural(history[0].items, t.items, lang)}` : t.noGames}</p>;

  const max = niceMax(Math.max(...history.map(h => h.items)));
  const x = (i: number) => PAD.l + (i / (history.length - 1)) * (w - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const line = history.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(h.items).toFixed(1)}`).join('');
  const area = `${line}L${x(history.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const ticks = [0, max / 2, max];
  const last = history.length - 1;
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB', { month: 'short', day: 'numeric' });

  const pick = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const i = Math.round(((clientX - r.left - PAD.l) / (w - PAD.l - PAD.r)) * last);
    setHover(Math.min(last, Math.max(0, i)));
  };
  const h = hover !== null ? history[hover] : null;

  return (
    <div className="line-chart" ref={box}>
      <svg width={w} height={H} role="img" aria-label={t.itemsTrend}
        onMouseMove={e => pick(e.clientX)} onMouseLeave={() => setHover(null)}
        onClick={() => h && nav(`/matches/${h.id}`)} style={{ cursor: h ? 'pointer' : undefined }}>
        {ticks.map(v => (
          <g key={v}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="axis-text">{v}</text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} className="axis-text">{date(history[0].endedAt)}</text>
        <text x={w - PAD.r} y={H - 6} textAnchor="end" className="axis-text">{date(history[last].endedAt)}</text>
        <path d={area} className="area" />
        <path d={line} className="series" />
        <circle cx={x(last)} cy={y(history[last].items)} r={4} className="end-dot" />
        <text x={x(last) + 8} y={y(history[last].items) + 4} className="end-label">{history[last].items}</text>
        {h && (
          <g pointerEvents="none">
            <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={H - PAD.b} className="crosshair" />
            <circle cx={x(hover!)} cy={y(h.items)} r={5} className="end-dot" />
          </g>
        )}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(x(hover!), 70), w - 70), top: y(h.items) - 8 }}>
          <b>{h.items}</b> {plural(h.items, t.items, lang)} · <span className={`result ${h.result}`}>{t.result[h.result]}</span>
          <br /><span className="muted">{formatDate(h.endedAt, lang)}</span>
        </div>
      )}
    </div>
  );
}
