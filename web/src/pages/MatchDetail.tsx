import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { getMatch, NotFound, type Match, type MatchEvent } from '../api';
import { Status } from '../components/Layout';
import { TeamCard } from '../components/TeamCard';
import { Timeline } from '../components/Timeline';
import { formatDate, formatDuration } from '../format';
import { useGoals } from '../goals';
import { useLang, type Strings } from '../i18n';
import { teamName } from '../teams';

// option values as bingo-reporter sends them, e.g. "cards:1", "teams_win:2", "end_game"
function optionValue(key: string, v: unknown, t: Strings) {
  if (typeof v === 'boolean') return v ? t.yes : t.no;
  if (key === 'timeLimitSeconds' && typeof v === 'number') return formatDuration(v * 1000);
  const [name, n] = String(v).split(':');
  const known = t.optValue[String(v)] ?? t.optValue[name];
  if (known) return typeof known === 'function' ? known(Number(n)) : known;
  return String(v).replace(/^minecraft:/, '').replace(/_/g, ' ');
}

export function MatchDetail() {
  const { id } = useParams();
  const { t } = useLang();
  return (
    <>
      <Link to="/matches" className="back">{t.back}</Link>
      <MatchView id={id!} />
    </>
  );
}

/** Everything about one match; used as a page and inside the records split view. */
export function MatchView({ id, compact = false }: { id: string; compact?: boolean }) {
  const { lang, t } = useLang();
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState<'missing' | 'failed' | null>(null);
  const goals = useGoals(match?.modVersion);
  const [focus, setFocus] = useState<MatchEvent | null>(null);

  useEffect(() => {
    let live = true;
    setMatch(null); setError(null);
    getMatch(id).then(m => live && setMatch(m))
      .catch(e => live && setError(e instanceof NotFound ? 'missing' : 'failed'));
    return () => { live = false; };
  }, [id]);

  if (error) return <Status>{error === 'missing' ? t.notFound : t.error}</Status>;
  if (!match) return <Status>{t.loading}</Status>;

  // every team gets its own card, like the mod's end screen: a shared card is shown once per team,
  // each with that team's own completions
  const cardFor = (teamId: string) => match.boards.find(b => b.teams.includes(teamId)) ?? match.boards[0];
  const winners = match.teams.filter(tm => tm.winner);
  const names = (ids: string[]) => ids.map(i => teamName(i, lang)).join(lang === 'zh' ? '、' : ', ');
  // only show options that were actually switched on or have a value worth reading
  const options = Object.entries(match.options).filter(([, v]) => v !== false);

  return (
    <div className={compact ? 'match-view compact' : 'match-view'}>
      {compact && <Link to={`/matches/${match.id}`} className="open-full">{t.openFull} ↗</Link>}
      <div className="match-head">
        <h1>{formatDate(match.endedAt, lang)}</h1>
        <p className="muted">
          {t.duration} {formatDuration(match.durationMs)} · {winners.length ? `${t.winner}: ${names(winners.map(w => w.id))}` : t.draw}
        </p>
      </div>

      <section className="cards-panel" aria-label={t.cards_}>
        {goals
          ? match.teams.map(tm => <TeamCard key={tm.id} team={tm} board={cardFor(tm.id)} goals={goals.goals} version={goals.version}
              highlight={focus?.team === tm.id ? focus.objectiveId : null} />)
          : <Status>{t.loading}</Status>}
      </section>

      {goals && (
        <section className="panel timeline-panel">
          <h2>{t.timeline}{match.events.length > 0 && <span className="muted count-badge"> · {match.events.length}</span>}</h2>
          <Timeline match={match} goals={goals.goals} version={goals.version} onFocusGoal={setFocus} />
        </section>
      )}

      <section className="meta">
        <h2>{t.settings}</h2>
        <dl>
          {options.map(([k, v]) => (
            <div key={k}><dt>{t.opt[k] ?? k}</dt><dd>{optionValue(k, v, t)}</dd></div>
          ))}
          <div><dt>{t.mod}</dt><dd>{match.modVersion} (MC {match.mcVersion})</dd></div>
          <div><dt>{t.seed}</dt><dd className="mono">{[...new Set(match.boards.map(b => b.seed))].join(', ')}</dd></div>
          <div><dt>{t.uploadedBy}</dt><dd>{match.uploader}</dd></div>
        </dl>
      </section>
    </div>
  );
}
