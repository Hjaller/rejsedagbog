import type { Session } from "@rejsedagbog/auth";
import type { Database } from "@rejsedagbog/db";

export type Context = {
  session: Session | null;
  db: Database;
};
