import { Link } from 'react-router';
import type { MatchSummary } from '../api';
import { formatDate, formatDuration } from '../format';
import { useLang } from '../i18n';
import { ModeTags } from './ModeTags';
import { teamColor, teamName } from '../teams';

/** A match in a list. `highlight` marks the team of the player whose page this is. */
/** With `onSelect` the row is a checkbox (the list's multi-select) instead of a link. */
export function MatchRow({ m, highlight, selected, onSelect }: { m: MatchSummary; highlight?: string; selected?: boolean; onSelect?: (e: React.MouseEvent) => void }) {
  const { lang, t } = useLang();
  const mine = highlight ? m.teams.find(tm => tm.players.some(p => p.uuid === highlight)) : undefined;
  const result = mine ? (mine.winner ? 'win' : m.teams.some(tm => tm.winner) ? 'loss' : 'draw') : undefined;
  return (
    <Wrap to={`/matches/${m.id}`} onSelect={onSelect} className={'match-row' + (result ? ` ${result}` : '') + (onSelect ? ' selectable' : '') + (selected ? ' selected' : '')}>
      {onSelect && <input type="checkbox" className="row-check" checked={!!selected} readOnly tabIndex={-1} />}
      <div className="match-when">
        <span>{formatDate(m.endedAt, lang)}{m.source === 'yab-stats' && <span className="src-tag" title={t.importedTip}>{t.imported}</span>}{m.excluded && <span className="src-tag excluded">{t.excludedTag}</span>}<ModeTags modes={m.modes ?? []} /></span>
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
    </Wrap>
  );
}

function Wrap({ to, onSelect, className, children }: { to: string; onSelect?: (e: React.MouseEvent) => void; className: string; children: React.ReactNode }) {
  if (!onSelect) return <Link to={to} className={className}>{children}</Link>;
  return (
    <div role="checkbox" aria-checked={className.includes(' selected')} tabIndex={0} className={className}
      onClick={onSelect} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onSelect(e as unknown as React.MouseEvent); } }}>
      {children}
    </div>
  );
}
