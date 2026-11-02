import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { listPlayers, type PlayerListing } from '../api';
import { Status } from '../components/Layout';
import { avatarUrl, formatDate } from '../format';
import { useLang } from '../i18n';
import { useMe } from '../me';
import { useAccount } from '../account';
import { LinkFlow } from './AccountPage';

function PlayerGrid() {
  const { lang, t } = useLang();
  const [players, setPlayers] = useState<PlayerListing[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { listPlayers().then(setPlayers).catch(() => setError(true)); }, []);

  if (error) return <Status>{t.error}</Status>;
  if (!players) return <Status>{t.loading}</Status>;
  if (!players.length) return <Status>{t.none}</Status>;
  return (
    <div className="player-grid">
      {players.map(p => (
        <Link key={p.uuid} to={`/players/${p.uuid}`} className="player-tile">
          <img src={avatarUrl(p.uuid, 64)} alt="" width={40} height={40} />
          <span>
            <b>{p.name}</b>
            <span className="muted small">{t.gamesCount(p.games)} · {formatDate(p.lastPlayed, lang)}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/**
 * "/" (我的主页): who you are comes only from your account. Logged out → log in with Discord;
 * logged in without a character → link one with /bingo link; otherwise → your player page.
 */
export function MePage() {
  const { t } = useLang();
  const { account } = useAccount();
  const me = useMe();
  const [linking, setLinking] = useState(false);

  if (!account) return <Status>{t.loading}</Status>;
  if (me) return <Navigate to={`/players/${me}`} replace />;

  if (!account.user) {
    return (
      <div className="login-box">
        <h1>{t.homeLogin}</h1>
        <p className="muted">{t.homeLoginHint}</p>
        {account.discord
          ? <a className="discord-btn" href="/api/auth/discord">{t.loginDiscord}</a>
          : <p className="muted small">{t.discordOff}</p>}
      </div>
    );
  }

  return (
    <div className="login-box">
      <h1>{t.homeLink}</h1>
      <p className="muted">{t.homeLinkHint}</p>
      <div className="home-link">
        {linking ? <LinkFlow onDone={() => setLinking(false)} /> : <button className="pill" onClick={() => setLinking(true)}>{t.linkPlayer}</button>}
      </div>
    </div>
  );
}

export function PlayersPage() {
  const { t } = useLang();
  return (
    <>
      <h1>{t.players}</h1>
      <PlayerGrid />
    </>
  );
}
