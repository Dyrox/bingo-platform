import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getAccount, type Account } from './api';

const Ctx = createContext<{ account: Account | null; refresh: () => Promise<Account | null> }>(null!);

/** Who is logged in (via Discord), their linked Minecraft players and upload keys. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const refresh = useCallback(async () => {
    try { const a = await getAccount(); setAccount(a); return a; } catch { return null; }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return <Ctx.Provider value={{ account, refresh }}>{children}</Ctx.Provider>;
}

export const useAccount = () => useContext(Ctx);
