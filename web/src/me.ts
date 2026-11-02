import { useAccount } from './account';

// Earlier builds let you pick "your" player by hand and kept it in the browser; that's gone,
// since anyone could claim anyone. Clear what those builds left behind.
try { localStorage.removeItem('bingo-me'); } catch { /* private mode */ }

/** The Minecraft player linked to the logged-in account (Discord login + /bingo link), or null. */
export function useMe(): string | null {
  const { account } = useAccount();
  return account?.players?.[0]?.uuid ?? null;
}
