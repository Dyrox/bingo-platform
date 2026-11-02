import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getLeaderboard, type LeaderboardRow } from '../api';
import { Status } from '../components/Layout';
import { clock } from '../components/Timeline';
import { avatarUrl } from '../format';
import { useLang } from '../i18n';
import { useMe } from '../me';

type Key = 'wins' | 'games' | 'winRate' | 'items' | 'bestWinStreak' | 'fastestLineMs' | 'fastestCardMs';
// times rank lowest-first; everything else highest-first; players without a value go last
const ASCENDING: Key[] = ['fastestLineMs', 'fastestCardMs'];

export function LeaderboardPage() {
  const { t } = useLang();
  const B = t.board;
  const me = useMe();
  const [period, setPeriod] = useState<'all' | 'month'>('all');
  const [sort, setSort] = useState<Key>('wins');
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setRows(null);
    getLeaderboard(period).then(r => live && setRows(r)).catch(() => live && setError(true));
    return () => { live = false; };
  }, [period]);

  const sorted = rows && [...rows].sort((a, b) => {
    const x = a[sort], y = b[sort];
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    return ASCENDING.includes(sort) ? x - y : y - x;
  });

  const head = (key: Key, label: string) => (
    <th aria-sort={sort === key ? (ASCENDING.includes(key) ? 'ascending' : 'descending') : undefined}>
      <button className={'th-sort' + (sort === key ? ' on' : '')} onClick={() => setSort(key)}>{label}</button>
    </th>
  );
  const medal = (i: number) => (sort === 'wins' ? ['🥇', '🥈', '🥉'][i] : undefined) ?? i + 1;

  return (
    <>
      <div className="board-head">
        <h1>{B.title}</h1>
        <div className="seg">
          <button aria-pressed={period === 'all'} onClick={() => setPeriod('all')}>{B.all}</button>
          <button aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>{B.month}</button>
        </div>
      </div>
      {error ? <Status>{t.error}</Status> : !sorted ? <Status>{t.loading}</Status> : !sorted.length ? <Status>{B.empty}</Status> : (
        <>
          <div className="table-wrap">
            <table className="board-table">
              <thead>
                <tr>
                  <th className="rank">#</th>
                  <th className="who-col">{B.player}</th>
                  {head('wins', B.record)}
                  {head('winRate', B.winRate)}
                  {head('games', B.games)}
                  {head('items', B.items)}
                  {head('bestWinStreak', B.streak)}
                  {head('fastestLineMs', B.line)}
                  {head('fastestCardMs', B.card)}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={r.uuid} className={r.uuid === me ? 'me' : undefined}>
                    <td className="rank">{medal(i)}</td>
                    <td className="who-col">
                      <Link to={`/players/${r.uuid}`} className="player">
                        <img src={avatarUrl(r.uuid, 48)} alt="" width={24} height={24} loading="lazy" />{r.name}
                      </Link>
                    </td>
                    <td><b>{r.wins}</b> <i>/</i> {r.losses} <i>/</i> {r.draws}</td>
                    <td>{r.winRate === null ? '–' : `${Math.round(r.winRate * 100)}%`}</td>
                    <td>{r.games}</td>
                    <td>{r.items}</td>
                    <td>{r.bestWinStreak}</td>
                    <td>{r.fastestLineMs === null ? '–' : clock(r.fastestLineMs)}</td>
                    <td>{r.fastestCardMs === null ? '–' : clock(r.fastestCardMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{B.timeHint}</p>
        </>
      )}
    </>
  );
}
