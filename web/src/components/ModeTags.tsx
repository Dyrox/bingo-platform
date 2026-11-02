import { useLang } from '../i18n';

/** YAB's game modes as small tags, named and explained the way the game's menu does. */
export function ModeTags({ modes }: { modes: string[] }) {
  const { t } = useLang();
  return <>{modes.map(m => (
    <span key={m} className={'src-tag mode ' + m} title={t.modeTip[m]}>{String(t.optValue[m] ?? m)}</span>
  ))}</>;
}
