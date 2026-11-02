import type { PlayerProfile } from '../api';
import { GoalIcon } from '../components/GoalIcon';
import { Heatmap } from '../components/Heatmap';
import { PlayerLink } from '../components/Teams';
import { clock } from '../components/Timeline';
import { prettyId, useGoals } from '../goals';
import { ItemsChart } from '../components/ItemsChart';
import { formatDuration } from '../format';
import { useLang } from '../i18n';
import { teamColor, teamName } from '../teams';
import { useProfile } from './PlayerShell';

const hours = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/** Who this player has played against, and their record against each: wins, losses and draws as one bar. */
function Rivals({ rivals }: { rivals: PlayerProfile['rivals'] }) {
  const { t } = useLang();
  if (!rivals.length) return <p className="muted">{t.rivals.none}</p>;
  return (
    <ul className="rivals">
      {rivals.map(r => (
        <li key={r.uuid}>
          <PlayerLink uuid={r.uuid} name={r.name} />
          <span className="rival-bar" role="img" aria-label={t.rivals.record(r.wins, r.losses, r.draws)}>
            {r.wins > 0 && <span className="w" style={{ flex: r.wins }} />}
            {r.draws > 0 && <span className="d" style={{ flex: r.draws }} />}
            {r.losses > 0 && <span className="l" style={{ flex: r.losses }} />}
          </span>
          <span className="rival-record">{t.rivals.record(r.wins, r.losses, r.draws)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The goals this player completes most (and fastest) and the ones they miss most, from their own cards. */
function MyGoals({ goals }: { goals: PlayerProfile['goals'] }) {
  const { lang, t } = useLang();
  const data = useGoals('latest');
  if (!goals.best.length && !goals.worst.length) return <p className="muted">{t.myGoals.none}</p>;
  if (!data) return null;
  const row = (g: PlayerProfile['goals']['best'][number], kind: 'best' | 'worst') => {
    const info = data.goals[g.objectiveId];
    const name = info ? (lang === 'zh' ? info.z ?? info.n : info.n) : prettyId(g.objectiveId);
    return (
      <li key={g.objectiveId}>
        <GoalIcon goal={info} version={data.version} size={24} />
        <span className="mg-name">{name}</span>
        <span className="muted small">
          {kind === 'best' ? t.myGoals.done(g.completions, g.appearances) : t.myGoals.missed(g.appearances - g.completions, g.appearances)}
          {kind === 'best' && g.avgMs !== null && <> · {t.myGoals.avg} {clock(g.avgMs)}</>}
        </span>
      </li>
    );
  };
  return (
    <div className="my-goals">
      <div><h3>{t.myGoals.best}</h3><ul>{goals.best.map(g => row(g, 'best'))}</ul></div>
      <div><h3>{t.myGoals.worst}</h3><ul>{goals.worst.map(g => row(g, 'worst'))}</ul></div>
    </div>
  );
}

/** 主页 tab: headline numbers, this month, opponents, goals, activity and the items trend. */
export function ProfileHome() {
  const p = useProfile();
  const { lang, t } = useLang();
  const a = p.allTime, m = p.monthly;
  const decided = a.wins + a.losses;
  const rate = decided ? `${Math.round((a.wins / decided) * 100)}%` : '–';
  const wld = (x: { wins: number; losses: number; draws: number }) => <>{x.wins} <i>/</i> {x.losses} <i>/</i> {x.draws}</>;

  return (
    <>
      <section className="stats">
        <Stat label={t.stat.games} value={a.games} />
        <Stat label={t.stat.record} value={wld(a)} />
        <Stat label={t.stat.winRate} value={rate} />
        <Stat label={t.stat.items} value={a.items} />
        <Stat label={t.stat.playtime} value={hours(a.playtimeMs)} />
        <Stat label={t.stat.streak} value={a.winStreak} sub={`${t.stat.best} ${a.bestWinStreak}`} />
        <Stat label={t.stat.bestItems} value={a.bestItems} />
        {p.favoriteTeam && (
          <Stat label={t.stat.favTeam}
            value={<span className="fav"><span className="dot" style={{ background: teamColor(p.favoriteTeam.teamId) }} />{teamName(p.favoriteTeam.teamId, lang)}</span>}
            sub={`${Math.round(p.favoriteTeam.share * 100)}%`} />
        )}
      </section>

      <section className="stats month">
        <h2>{t.stat.thisMonth}</h2>
        <Stat label={t.stat.games} value={m.games} />
        <Stat label={t.stat.record} value={wld(m)} />
        <Stat label={t.stat.items} value={m.items} />
        <Stat label={t.stat.playtime} value={m.playtimeMs ? hours(m.playtimeMs) : formatDuration(0)} />
      </section>

      <div className="panel-pair">
        <section className="panel">
          <h2>{t.rivals.title}</h2>
          <Rivals rivals={p.rivals} />
        </section>
        <section className="panel">
          <h2>{t.myGoals.title}</h2>
          <MyGoals goals={p.goals} />
        </section>
      </div>

      <section className="panel">
        <h2>{t.activity}</h2>
        <Heatmap dates={p.history.map(h => h.endedAt)} />
      </section>

      <section className="panel">
        <h2>{t.itemsTrend}</h2>
        <ItemsChart history={p.history} />
      </section>
    </>
  );
}
