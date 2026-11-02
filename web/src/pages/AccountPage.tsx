import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { createLinkCode, createUploadKey, logout, revokeUploadKey, unlinkPlayer } from '../api';
import { useAccount } from '../account';
import { Status } from '../components/Layout';
import { avatarUrl, formatDate } from '../format';
import { useLang } from '../i18n';

function CopyButton({ text }: { text: string }) {
  const { t } = useLang();
  const [done, setDone] = useState(false);
  return (
    <button className="pill small" onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}>
      {done ? t.copied : t.copy}
    </button>
  );
}

/** Shows a fresh code and polls the account until a new character shows up (the player typed it in game). */
export function LinkFlow({ onDone }: { onDone: () => void }) {
  const { t } = useLang();
  const { account, refresh } = useAccount();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const before = useRef(new Set(account?.players?.map(p => p.uuid)));

  useEffect(() => { createLinkCode().then(setCode); }, []);
  useEffect(() => {
    if (!code || linked) return;
    const timer = setInterval(async () => {
      const a = await refresh();
      const fresh = a?.players?.find(p => !before.current.has(p.uuid));
      if (fresh) { setLinked(fresh.name); setTimeout(onDone, 2500); }
      if (Date.parse(code.expiresAt) < Date.now()) onDone();
    }, 3000);
    return () => clearInterval(timer);
  }, [code, linked, refresh, onDone]);

  if (linked) return <p className="link-done">✔ {t.linkDone(linked)}</p>;
  if (!code) return <Status>{t.loading}</Status>;
  const command = `/bingo link ${code.code}`;
  return (
    <div className="link-flow">
      <span className="muted">{t.linkStep}</span>
      <div className="link-command"><code>{command}</code><CopyButton text={command} /></div>
      <span className="muted small">{t.linkWaiting} · {t.linkExpires(Math.round((Date.parse(code.expiresAt) - Date.now()) / 60000))}</span>
    </div>
  );
}

function Keys() {
  const { t, lang } = useLang();
  const { account, refresh } = useAccount();
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const keys = account?.keys ?? [];

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const { key } = await createUploadKey(name.trim());
    setFresh(key); setName(''); refresh();
  };
  // deployed, the site and the API share one address; in dev the reporter should talk to the backend
  // directly, so uploads don't depend on the Vite dev server running
  const apiUrl = import.meta.env.DEV ? 'http://localhost:3000' : location.origin;
  const config = fresh && JSON.stringify({ api_url: apiUrl, key: fresh }, null, 2);

  return (
    <section className="panel">
      <h2>{t.keys}</h2>
      <p className="muted small">{t.keysHint}</p>
      {keys.length === 0 && <p className="muted">{t.noKeys}</p>}
      <ul className="key-list">
        {keys.map(k => (
          <li key={k.id}>
            <span><b>{k.name}</b> <code className="muted">{k.prefix}…</code></span>
            <span className="muted small">{t.created} {formatDate(k.createdAt, lang)} · {t.lastUsed} {k.lastUsedAt ? formatDate(k.lastUsedAt, lang) : t.never}</span>
            <button className="pill small danger" onClick={() => revokeUploadKey(k.id).then(refresh)}>{t.revoke}</button>
          </li>
        ))}
      </ul>
      {fresh && (
        <div className="key-fresh">
          <span>{t.keyOnce}</span>
          <div className="link-command"><code>{fresh}</code><CopyButton text={fresh} /></div>
          <pre>{config}</pre>
        </div>
      )}
      <form className="key-form" onSubmit={create}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t.keyName} maxLength={40} />
        <button className="pill" disabled={!name.trim()}>{t.createKey}</button>
      </form>
    </section>
  );
}

export function AccountPage() {
  const { t } = useLang();
  const { account, refresh } = useAccount();
  const [params] = useSearchParams();
  const [linking, setLinking] = useState(false);

  if (!account) return <Status>{t.loading}</Status>;

  if (!account.user) {
    return (
      <div className="login-box">
        <h1>{t.account}</h1>
        {params.get('login') === 'failed' && <p className="error">{t.loginFailed}</p>}
        <p className="muted">{t.loginHint}</p>
        {account.discord
          ? <a className="discord-btn" href="/api/auth/discord">{t.loginDiscord}</a>
          : <p className="muted small">{t.discordOff}</p>}
      </div>
    );
  }

  const players = account.players ?? [];
  return (
    <>
      <div className="player-head">
        {account.user.avatarUrl && <img src={account.user.avatarUrl} alt="" width={64} height={64} className="round" />}
        <div className="player-id"><h1>{account.user.name}</h1><span className="muted">Discord</span></div>
        <button className="pill" onClick={() => logout().then(refresh)}>{t.logout}</button>
      </div>

      <section className="panel">
        <h2>{t.myPlayers}</h2>
        {players.length === 0 && !linking && <p className="muted">{t.noPlayers}</p>}
        <ul className="linked-players">
          {players.map(p => (
            <li key={p.uuid}>
              <Link to={`/players/${p.uuid}`} className="player"><img src={avatarUrl(p.uuid, 48)} alt="" width={24} height={24} />{p.name}</Link>
              <button className="pill small" onClick={() => unlinkPlayer(p.uuid).then(refresh)}>{t.unlink}</button>
            </li>
          ))}
        </ul>
        {linking
          ? <LinkFlow onDone={() => setLinking(false)} />
          : <button className="pill" onClick={() => setLinking(true)}>{t.linkPlayer}</button>}
      </section>

      <Keys />
    </>
  );
}
