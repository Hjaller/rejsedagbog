import { createContext, use, useMemo, type ReactNode } from "react";

import { getLocalDb, type LocalDb } from "./database";

export type CurrentUser = { id: string; name: string; email: string };

type LocalDbContextValue = { db: LocalDb; user: CurrentUser };

const LocalDbContext = createContext<LocalDbContextValue | null>(null);

/** Åbner den indloggede brugers lokale database. Lægges inden for auth-gaten. */
export function LocalDbProvider({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const value = useMemo(() => ({ db: getLocalDb(user.id), user }), [user]);
  return <LocalDbContext value={value}>{children}</LocalDbContext>;
}

export function useLocalDb(): LocalDbContextValue {
  const ctx = use(LocalDbContext);
  if (!ctx) throw new Error("useLocalDb skal bruges inden for <LocalDbProvider>");
  return ctx;
}
