import { useEffect, useState } from 'react';

// A match was excluded, counted again or deleted somewhere on the page: lists and stats that are
// already showing (the records tab, the player header) reload so they don't show stale data.
const EVENT = 'bingo:matches-changed';

export const announceMatchesChanged = () => window.dispatchEvent(new Event(EVENT));

/** A number that goes up on every change; put it in an effect's dependencies to reload. */
export function useMatchesVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV(x => x + 1);
    window.addEventListener(EVENT, bump);
    return () => window.removeEventListener(EVENT, bump);
  }, []);
  return v;
}
