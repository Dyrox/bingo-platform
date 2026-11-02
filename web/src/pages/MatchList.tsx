import { useEffect, useState } from 'react';
import { listMatches, type MatchSummary } from '../api';
import { Status } from '../components/Layout';
import { MatchRow } from '../components/MatchRow';
import { useLang } from '../i18n';

/** Paged list of matches; reused by the player page with `player` set. */
export function MatchFeed({ player, onLoad }: { player?: string; onLoad?: (all: MatchSummary[]) => void }) {
  const { t } = useLang();
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setMatches(null); setError(false);
    listMatches({ player }).then(p => {
      if (!live) return;
      setMatches(p.matches); setNext(p.next); onLoad?.(p.matches);
    }).catch(() => live && setError(true));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const more = async () => {
    if (!next || !matches) return;
    setBusy(true);
    try {
      const p = await listMatches({ player, before: next });
      const all = [...matches, ...p.matches];
      setMatches(all); setNext(p.next); onLoad?.(all);
    } catch { setError(true); } finally { setBusy(false); }
  };

  if (error && !matches) return <Status>{t.error}</Status>;
  if (!matches) return <Status>{t.loading}</Status>;
  if (!matches.length) return <Status>{t.none}</Status>;
  return (
    <>
      <div className="match-list">
        {matches.map(m => <MatchRow key={m.id} m={m} highlight={player} />)}
      </div>
      {next && <button className="more" onClick={more} disabled={busy}>{busy ? t.loading : t.loadMore}</button>}
    </>
  );
}

export function MatchList() {
  const { t } = useLang();
  return (
    <>
      <h1>{t.allMatches}</h1>
      <MatchFeed />
    </>
  );
}
