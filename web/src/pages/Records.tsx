import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { listMatches, type MatchSummary, type Result } from '../api';
import { Status } from '../components/Layout';
import { formatDuration } from '../format';
import { plural, useLang } from '../i18n';
import { teamColor, teamName } from '../teams';
import { MatchView } from './MatchDetail';
import { useProfile } from './PlayerShell';

/** 记录 tab: the player's matches by day on the left, the picked one on the right (stacked on phones). */
export function Records() {
  const p = useProfile();
  const { matchId } = useParams();
  const nav = useNavigate();
  const { lang, t } = useLang();
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setMatches(null);
    listMatches({ player: p.uuid, limit: 50 }).then(r => { if (live) { setMatches(r.matches); setNext(r.next); } })
      .catch(() => live && setError(true));
    return () => { live = false; };
  }, [p.uuid]);

  const more = async () => {
    const r = await listMatches({ player: p.uuid, before: next!, limit: 50 });
    setMatches(m => [...(m ?? []), ...r.matches]); setNext(r.next);
  };

  if (error) return <Status>{t.error}</Status>;
  if (!matches) return <Status>{t.loading}</Status>;
  if (!matches.length) return <Status>{t.noGames}</Status>;

  const resultOf = new Map(p.history.map(h => [h.id, h.result]));
  const day = (iso: string) => new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  const groups: { day: string; list: MatchSummary[] }[] = [];
  for (const m of matches) {
    const d = day(m.endedAt);
    if (groups.at(-1)?.day !== d) groups.push({ day: d, list: [] });
    groups.at(-1)!.list.push(m);
  }

  const open = (id: string) => {
    // phones have no room for the side panel; go to the full match page instead
    if (window.matchMedia('(max-width: 900px)').matches) nav(`/matches/${id}`);
    else nav(`/players/${p.uuid}/records/${id}`);
  };

  return (
    <div className={'records' + (matchId ? ' has-detail' : '')}>
      <div className="record-list">
        {groups.map(g => (
          <section key={g.day}>
            <h3 className="day">{g.day}</h3>
            {g.list.map(m => {
              const mine = m.teams.find(tm => tm.players.some(pl => pl.uuid === p.uuid));
              const rivals = m.teams.filter(tm => tm !== mine);
              const result: Result = resultOf.get(m.id) ?? 'draw';
              return (
                <button key={m.id} className={'record' + (m.id === matchId ? ' active' : '')} onClick={() => open(m.id)}>
                  <span className={`result ${result}`}>{t.result[result]}</span>
                  <span className="record-main">
                    <span className="record-team">
                      {mine && <span className="dot" style={{ background: teamColor(mine.id) }} />}
                      {mine ? teamName(mine.id, lang) : ''}
                      {rivals.length > 0 && <span className="muted"> {t.vsLabel} {rivals.map(r => r.players.map(pl => pl.name).join(', ') || teamName(r.id, lang)).join(' · ')}</span>}
                    </span>
                    <span className="muted small">
                      {new Date(m.endedAt).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit' })} · {formatDuration(m.durationMs)}
                    </span>
                  </span>
                  <span className="record-score"><b>{mine?.items ?? 0}</b><span className="muted small">{plural(mine?.items ?? 0, t.items, lang)}</span></span>
                </button>
              );
            })}
          </section>
        ))}
        {next && <button className="more" onClick={more}>{t.loadMore}</button>}
      </div>
      <div className="record-detail">
        {matchId ? <MatchView key={matchId} id={matchId} compact /> : <p className="status">{t.pickMatch}</p>}
      </div>
    </div>
  );
}
