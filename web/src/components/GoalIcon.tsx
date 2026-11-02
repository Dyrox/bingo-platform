import { iconFile, type Goal } from '../goals';

// Same geometry as the mod's CardTileRenderer (and the tier guide), in % of the tile:
// "any of" stacks the first 3 items at 75% size, each shifted 12.5% down-right behind the last;
// "all of" tiles the first 4 at 56.25% in a 2x2 grid; "never get" goals get the forbidden frame on top.
export function GoalIcon({ goal, version, size = 32 }: { goal?: Goal; version: string; size?: number | string }) {
  const src = (key: string) => `/goals/${version}/icons/${iconFile(key)}`;
  const img = (key: string | undefined, style: React.CSSProperties = {}, k?: number) =>
    key ? <img key={k} src={src(key)} alt="" loading="lazy" style={style} /> : null;

  let inner: React.ReactNode;
  if (!goal) inner = <span className="ico-missing">?</span>;
  else if (goal.img) inner = img('img:' + goal.img);
  else if (goal.s === 'one' && goal.ii) {
    inner = goal.ii.map((id, i) => img(id, { width: '75%', height: '75%', left: `${i * 12.5}%`, top: `${i * 12.5}%`, zIndex: 3 - i }, i));
  } else if (goal.s === 'all' && goal.ii) {
    inner = goal.ii.map((id, i) => img(id, { width: '56.25%', height: '56.25%', left: `${(i % 2) * 42.1875}%`, top: `${Math.floor(i / 2) * 42.1875}%` }, i));
  } else inner = img(goal.i);

  return (
    <span className="ico" style={{ width: size, height: size }}>
      {inner}
      {goal?.x ? img('deco:forbidden', { width: '125%', height: '125%', left: '-12.5%', top: '-12.5%', zIndex: 5 }) : null}
    </span>
  );
}
