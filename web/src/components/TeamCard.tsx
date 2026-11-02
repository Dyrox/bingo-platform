import { useEffect, useState } from 'react';
import type { Board, Team } from '../api';
import type { ReplayFrame } from '../replay';
import { prettyId, type Goal, type Goals } from '../goals';
import { useLang } from '../i18n';
import { cardLabel, cardStyle, teamName } from '../teams';
import { GoalIcon } from './GoalIcon';
import { McText } from './McText';
import { WinStars } from './WinStars';
import { PlayerLink, Score } from './Teams';

// Geometry from the mod's ClientCardBufferRenderer, in card pixels:
// the frame is 122x132, tile (x, y) is an 18x18 slot at (12 + 20x, 22 + 20y), the item is 16x16 at +1,+1,
// decorations are 20x20 at -1,-1, and the team name is drawn at (12, 10), cut to 70px.
const W = 122, H = 132;
const pctX = (n: number) => `${(n / W) * 100}%`;
const pctY = (n: number) => `${(n / H) * 100}%`;
const UNIT = 'calc(100cqw / 122)'; // one card pixel, in CSS
const ACHIEVED = '#55ff55';        // BingoCardColors.DEFAULTS.tileAchievedColor

/** Which goals the mod frames with the little star (see Decoration.ADVANCEMENT in YAB's objective managers). */
const starred = (g?: Goal) => !!g && (g.c === 'advancement' || (g.c === 'challenge' && g.k === 'stat'));

/**
 * One team's view of its card, drawn like the mod's end-of-game screen.
 * With `frame` (replay), it shows what every team held at that moment instead of the final result.
 */
export function TeamCard({ team, board, goals, version, highlight, frame, finished = true, modes = [], hiddenTiers = false, tracksSeen = false }: {
  team: Team; board: Board; goals: Goals; version: string; highlight?: string | null;
  frame?: ReplayFrame | null; finished?: boolean;
  /** YAB's game modes; with `tracksSeen` (the timeline has "seen" entries), a replay hides undiscovered tiles */
  modes?: string[]; hiddenTiers?: boolean; tracksSeen?: boolean;
}) {
  const { lang, t } = useLang();
  const style = cardStyle(team.id);
  // the win burst plays when the card shows its final result: on opening the round, and when a replay reaches the end
  const won = team.winner && finished;
  const [burst, setBurst] = useState(0);
  useEffect(() => { if (won) setBurst(b => b + 1); }, [won]);
  const at = new Map(board.cells.map(c => [`${c.x},${c.y}`, c]));
  const sep = lang === 'zh' ? '、' : ', ';
  const holders = (objectiveId: string, completedBy: string[]) => frame
    ? [...frame.done].filter(([, held]) => held.has(objectiveId)).map(([teamId]) => teamId)
    : completedBy;
  // the score under the card follows the replay too: items = goals held on this card right now
  const shown: Team = frame ? {
    ...team,
    items: board.cells.filter(c => frame.done.get(team.id)?.has(c.objectiveId)).length,
    lines: frame.lines.get(team.id) ?? 0,
    cards: frame.cards.get(team.id) ?? 0,
  } : team;

  return (
    <figure className="team-board">
      <div className="mc-card" style={{ backgroundImage: `url(${style.frame})` }}>
        <McText text={cardLabel(team.id, team.players)} color={style.text} unit={UNIT} maxWidth={70}
          style={{ position: 'absolute', left: pctX(12), top: pctY(10) }} />
        {team.winner && finished && (
          <McText text="WINNER!" color={style.accent} unit={UNIT} shadow className="winner-tag" />
        )}
        {won && burst > 0 && <WinStars play={burst} />}
        {Array.from({ length: 25 }, (_, i) => {
          const x = i % 5, y = Math.floor(i / 5);
          const cell = at.get(`${x},${y}`);
          if (!cell) return null;
          const goal = goals[cell.objectiveId];
          const name = goal ? (lang === 'zh' ? goal.z ?? goal.n : goal.n) : prettyId(cell.objectiveId);
          const by = holders(cell.objectiveId, cell.completedBy);
          const got = by.includes(team.id);
          const others = by.filter(id => id !== team.id);
          const tier = cell.tier ?? goal?.t;
          // YAB's CardViewService.getTileState: in Lockout, a tile another team captured is locked for this one;
          // in Hidden Items, a tile stays a "?" until the team has seen it, and everything shows once the game is over
          const locked = modes.includes('lockout') && others.length > 0 && !got;
          const hidden = modes.includes('hidden_items') && tracksSeen && !!frame && !finished
            && !got && !frame.seen.get(team.id)?.has(cell.objectiveId);
          const hiddenImage = `/yab/image_hidden${hiddenTiers && tier ? '_' + tier.toLowerCase() : ''}.png`;
          return (
            <div key={i} className={'tile' + (highlight === cell.objectiveId ? ' flash' : '')} tabIndex={0} aria-label={name}
              style={{ left: pctX(12 + x * 20), top: pctY(22 + y * 20), width: pctX(18), height: pctY(18), background: got ? ACHIEVED : undefined }}>
              <span className="tile-item">
                {hidden ? <img className="ico" src={hiddenImage} alt="" /> : <GoalIcon goal={goal} version={version} size="100%" />}
              </span>
              {!hidden && starred(goal) && <img className="tile-deco" src="/yab/image_frame_advancement.png" alt="" />}
              {locked && <img className="tile-deco" src="/yab/image_frame_locked.png" alt="" />}
              {!hidden && cell.count && (
                // drawn like a stack size (GuiGraphics.itemDecorations): white, shadow #3f3f3f, right edge at
                // item x + 17 (= the tile's right edge), top at item y + 9
                <McText text={String(cell.count)} color="#ffffff" shadow shadowColor="#3f3f3f" unit={UNIT} className="tile-count" />
              )}
              <span className="tile-tip" role="tooltip">
                <b>{hidden ? '???' : name}</b>
                {tier && (!hidden || hiddenTiers) && <span className="tip-tier" style={{ color: `var(--t${tier})` }}>{tier}</span>}
                {hidden && <span className="muted">{t.hiddenTile}</span>}
                {!hidden && cell.count && <span>{t.countHere(cell.count)}</span>}
                {locked && <span>🔒 {t.lockedTile(others.map(o => teamName(o, lang)).join(sep))}</span>}
                <span className={got ? 'tip-got' : 'tip-miss'}>{got ? '✔ ' + t.got : '✘ ' + t.missed}</span>
                {others.length > 0 && <span className="tip-others">{t.alsoBy}{others.map(o => teamName(o, lang)).join(sep)}</span>}
              </span>
            </div>
          );
        })}
      </div>
      <figcaption>
        <Score team={shown} />
        <div className="team-players">{team.players.map(p => <PlayerLink key={p.uuid} {...p} />)}</div>
      </figcaption>
    </figure>
  );
}
