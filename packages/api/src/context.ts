import type { Session } from "@rejsedagbog/auth";
import type { Database } from "@rejsedagbog/db";

import type { MediaStorage } from "./storage";

export type Context = {
  session: Session | null;
  db: Database;
  /** null indtil S3-udbyderen er konfigureret (S3_* miljøvariabler). */
  storage: MediaStorage | null;
  /** Nøgle til REST Countries v5; null giver tomme landefakta. */
  restCountriesApiKey: string | null;
  /** Klientens IP (Fastifys request.ip; bag en proxy kun korrekt med TRUST_PROXY). Til rate limiting. */
  clientIp: string | null;
};
