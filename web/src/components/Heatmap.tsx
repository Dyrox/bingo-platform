import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '../i18n';

const WEEKS = 53, CELL = 11, GAP = 3, STEP = CELL + GAP, LEFT = 30, TOP = 18;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
// sequential green, one step per bucket: 1, 2, 3–4, 5+ games
const level = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4);

/** Games per day over the last year, a week per column (Sunday on top), like a contribution graph. */
export function Heatmap({ dates }: { dates: string[] }) {
  const { lang, t } = useLang();
  const scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; label: string } | null>(null);

  const { cells, months } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const iso of dates) { const k = dayKey(new Date(iso)); counts.set(k, (counts.get(k) ?? 0) + 1); }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7);
    const cells: { x: number; y: number; date: Date; n: number }[] = [];
    const months: { x: number; label: string }[] = [];
    for (let w = 0; w < WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(start); date.setDate(start.getDate() + w * 7 + d);
        if (date > today) break;
        cells.push({ x: w, y: d, date, n: counts.get(dayKey(date)) ?? 0 });
        if (date.getDate() === 1) months.push({ x: w, label: date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB', { month: 'short' }) });
      }
    }
    return { cells, months };
  }, [dates, lang]);

  // on a narrow screen the newest weeks matter most: start scrolled to the right
  useEffect(() => { const s = scroller.current; if (s) s.scrollLeft = s.scrollWidth; }, [cells]);

  const width = LEFT + WEEKS * STEP, height = TOP + 7 * STEP;
  return (
    <div className="heatmap-wrap" ref={scroller}>
      <svg width={width} height={height} role="img" aria-label={t.activity} onMouseLeave={() => setHover(null)}>
        {months.map(m => <text key={m.x} x={LEFT + m.x * STEP} y={11} className="axis-text">{m.label}</text>)}
        {t.weekdays.map((d, i) => d && <text key={i} x={0} y={TOP + i * STEP + 9} className="axis-text">{d}</text>)}
        {cells.map(c => (
          <rect key={`${c.x},${c.y}`} x={LEFT + c.x * STEP} y={TOP + c.y * STEP} width={CELL} height={CELL} rx={2}
            className={`hm hm${level(c.n)}`}
            onMouseEnter={() => setHover({
              x: LEFT + c.x * STEP + CELL / 2, y: TOP + c.y * STEP,
              label: `${c.date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' })} · ${t.dayGames(c.n)}`,
            })} />
        ))}
      </svg>
      {hover && <div className="chart-tip" style={{ left: hover.x, top: hover.y }}>{hover.label}</div>}
    </div>
  );
}
