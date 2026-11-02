import { useEffect, useRef } from 'react';
import { listedEvents, type Match, type MatchEvent } from '../api';
import { avatarUrl } from '../format';
import { prettyId, type Goals } from '../goals';
import { useLang } from '../i18n';
import { teamColor, teamName } from '../teams';
import { GoalIcon } from './GoalIcon';

/** In-game clock like YAB's chat messages: [7:35], or [1:02:10] past an hour. */
export const clock = (ms: number) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/**
 * The round as it happened, top to bottom: who got which goal when, lines and cards scored,
 * goals lost again. Hovering an entry lights up that goal on the cards (onFocusGoal).
 */
export function Timeline({ match, goals, version, onFocusGoal, now = null }: {
  match: Match; goals: Goals; version: string; onFocusGoal: (e: MatchEvent | null) => void;
  /** replay time: later entries are dimmed and the latest one is kept in view */
  now?: number | null;
}) {
  const { lang, t } = useLang();
  const list = useRef<HTMLOListElement>(null);
  const events = listedEvents(match);
  const current = now === null ? -1 : events.findLastIndex(e => e.t <= now);
  useEffect(() => {
    // scroll inside the timeline only, never the page
    const box = list.current, row = box?.children[current] as HTMLElement | undefined;
    if (box && row) box.scrollTop = row.offsetTop - box.clientHeight / 2;
  }, [current]);
  const names = new Map(match.teams.flatMap(tm => tm.players.map(p => [p.uuid, p.name])));
  const goalName = (id: string | null) => {
    if (!id) return '';
    const g = goals[id];
    return g ? (lang === 'zh' ? g.z ?? g.n : g.n) : prettyId(id);
  };

  if (!events.length) return <p className="muted timeline-empty">{t.noTimeline}</p>;

  return (
    <ol className="timeline" ref={list} onMouseLeave={() => onFocusGoal(null)}>
      {events.map((e, i) => {
        const who = e.player && names.get(e.player);
        const actor = (
          <span className="tl-actor">
            <span className="dot" style={{ background: teamColor(e.team) }} />
            {who
              ? <><img src={avatarUrl(e.player!, 32)} alt="" width={16} height={16} />{who}</>
              : <b>{teamName(e.team, lang)}</b>}
          </span>
        );
        const icon = e.type === 'goal' || e.type === 'lost'
          ? <span className={'tl-icon' + (e.type === 'lost' ? ' lost' : '')}><GoalIcon goal={e.objectiveId ? goals[e.objectiveId] : undefined} version={version} size={20} /></span>
          : e.type === 'line'
            ? <img className="tl-icon" src="/yab/message_check.png" alt="" width={20} height={20} />
            : <span className="tl-icon trophy">🏆</span>;
        return (
          <li key={i} className={`tl tl-${e.type}` + (now !== null && i > current ? ' future' : '') + (i === current ? ' current' : '')} tabIndex={0}
            onMouseEnter={() => onFocusGoal(e.objectiveId ? e : null)} onFocus={() => onFocusGoal(e.objectiveId ? e : null)}>
            {icon}
            <span className="tl-time">[{clock(e.t)}]</span>
            <span className="tl-text">
              {actor}{' '}
              {e.type === 'goal' && <>{t.ev.got} <span className="tl-goal">[{goalName(e.objectiveId)}]</span></>}
              {e.type === 'lost' && <>{t.ev.lost} <span className="tl-goal">[{goalName(e.objectiveId)}]</span></>}
              {e.type === 'line' && <span className="tl-big">{t.ev.lines(e.value ?? 1)}</span>}
              {e.type === 'card' && <span className="tl-big">{t.ev.card(e.value ?? 1)}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
