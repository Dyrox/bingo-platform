import { Link } from 'react-router';
import type { MatchSummary } from '../api';
import { formatDate, formatDuration } from '../format';
import { useLang } from '../i18n';
import { teamColor, teamName } from '../teams';

/** A match in a list. `highlight` marks the team of the player whose page this is. */
export function MatchRow({ m, highlight }: { m: MatchSummary; highlight?: string }) {
  const { lang, t } = useLang();
  const mine = highlight ? m.teams.find(tm => tm.players.some(p => p.uuid === highlight)) : undefined;
  const result = mine ? (mine.winner ? 'win' : m.teams.some(tm => tm.winner) ? 'loss' : 'draw') : undefined;
  return (
    <Link to={`/matches/${m.id}`} className={'match-row' + (result ? ` ${result}` : '')}>
      <div className="match-when">
        <span>{formatDate(m.endedAt, lang)}</span>
        <span className="muted">{formatDuration(m.durationMs)}</span>
      </div>
      <div className="match-teams">
        {m.teams.map(tm => (
          <div key={tm.id} className={'mt' + (tm.winner ? ' won' : '')} style={{ '--team': teamColor(tm.id) } as React.CSSProperties}>
            <span className="dot" />
            <span className="mt-name">{tm.players.map(p => p.name).join(', ') || teamName(tm.id, lang)}</span>
            <span className="mt-score">{tm.items}</span>
            {tm.winner && <span className="crown" title={t.winner}>🏆</span>}
          </div>
        ))}
      </div>
    </Link>
  );
}
