import { Link } from 'react-router';
import type { Team } from '../api';
import { avatarUrl } from '../format';
import { plural, useLang } from '../i18n';

export function PlayerLink({ uuid, name, size = 20 }: { uuid: string; name: string; size?: number }) {
  return (
    <Link className="player" to={`/players/${uuid}`}>
      <img src={avatarUrl(uuid, size * 2)} alt="" width={size} height={size} loading="lazy" />
      {name}
    </Link>
  );
}

export function Score({ team }: { team: Team }) {
  const { lang, t } = useLang();
  return (
    <span className="score">
      <b>{team.items}</b> {plural(team.items, t.items, lang)}
      {team.lines > 0 && <> · <b>{team.lines}</b> {plural(team.lines, t.lines, lang)}</>}
      {team.cards > 0 && <> · <b>{team.cards}</b> {plural(team.cards, t.cards, lang)}</>}
    </span>
  );
}
