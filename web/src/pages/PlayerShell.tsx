import { useEffect, useState } from 'react';
import { NavLink, Outlet, useOutletContext, useParams } from 'react-router';
import { getPlayer, NotFound, type PlayerProfile } from '../api';
import { Status } from '../components/Layout';
import { avatarUrl, formatDate } from '../format';
import { useLang } from '../i18n';
import { useAccount } from '../account';
import { useMatchesVersion } from '../changes';

/** Player header + 主页 / 记录 tabs; the tab pages read the profile through the outlet context. */
export function PlayerShell() {
  const { uuid } = useParams();
  const { lang, t } = useLang();
  const { account } = useAccount();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState<'missing' | 'failed' | null>(null);

  const version = useMatchesVersion();
  useEffect(() => { setProfile(null); setError(null); }, [uuid]);
  useEffect(() => {
    let live = true;
    // after a match changed, refresh in place rather than flashing "loading"
    getPlayer(uuid!).then(p => live && setProfile(p))
      .catch(e => live && setError(e instanceof NotFound ? 'missing' : 'failed'));
    return () => { live = false; };
  }, [uuid, version]);

  if (error) return <Status>{error === 'missing' ? t.notFound : t.error}</Status>;
  if (!profile) return <Status>{t.loading}</Status>;

  return (
    <>
      <div className="player-head">
        <img src={avatarUrl(profile.uuid, 128)} alt="" width={64} height={64} />
        <div className="player-id">
          <h1>{profile.name}</h1>
          {profile.lastPlayed && <span className="muted">{t.lastPlayed} {formatDate(profile.lastPlayed, lang)}</span>}
        </div>
        {account?.players?.some(p => p.uuid === profile.uuid) && <span className="me-badge">★ {t.isMe}</span>}
      </div>
      <nav className="tabs">
        <NavLink to={`/players/${profile.uuid}`} end>{t.home}</NavLink>
        <NavLink to={`/players/${profile.uuid}/records`}>{t.records}</NavLink>
      </nav>
      <Outlet context={profile} />
    </>
  );
}

export const useProfile = () => useOutletContext<PlayerProfile>();
