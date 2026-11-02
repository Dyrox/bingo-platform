import { Heatmap } from '../components/Heatmap';
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

/** 主页 tab: headline numbers, this month, activity and the items trend. */
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
