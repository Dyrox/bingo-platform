import { Link, NavLink, Outlet } from 'react-router';
import { useEffect } from 'react';
import { useLang } from '../i18n';
import { useMe } from '../me';
import { useAccount } from '../account';

export function Layout() {
  const { lang, setLang, t } = useLang();
  const me = useMe();
  const { account } = useAccount();
  useEffect(() => { document.title = t.site; }, [t.site]);
  return (
    <>
      <header className="top">
        <div className="wrap top-inner">
          {/* YAB's own wordmark (docs/banner.png in the mod's repo) */}
          <Link to="/" className="brand" aria-label={t.site}>
            <img src="/yab/logo.png" alt="Yet Another Bingo" width={93} height={40} />
            <span>{t.platform}</span>
          </Link>
          <nav>
            <NavLink to={me ? `/players/${me}` : '/'} end={!me}>{t.me}</NavLink>
            <NavLink to="/matches">{t.allMatches}</NavLink>
            <NavLink to="/players" end>{t.players}</NavLink>
            <NavLink to="/leaderboard">{t.board.nav}</NavLink>
            <NavLink to="/guide">{t.guide.nav}</NavLink>
          </nav>
          {account?.user
            ? <Link to="/account" className="who">{account.user.avatarUrl && <img src={account.user.avatarUrl} alt="" width={24} height={24} />}<span>{account.user.name}</span></Link>
            : account?.discord && <Link to="/account" className="login-link">{t.login}</Link>}
          <div className="seg" role="group" aria-label="语言 / Language">
            <button aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>中文</button>
            <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
          </div>
        </div>
      </header>
      <main className="wrap">
        <Outlet />
      </main>
    </>
  );
}

export function Status({ children }: { children: React.ReactNode }) {
  return <p className="status">{children}</p>;
}
