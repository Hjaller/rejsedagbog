import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { migrate } from "../../native/lib/local-db/migrations";
import type { LocalDb } from "../../native/lib/local-db/types";

/**
 * Appens lokale database i Node: node:sqlite med samme migrationer og den del af
 * expo-sqlites API, som repo-/synkroniseringskoden bruger.
 */
export function createLocalSqlite(): LocalDb {
  const raw = new DatabaseSync(":memory:");
  const args = (params: unknown[]) => params as SQLInputValue[];

  const adapter = {
    execSync: (sql: string) => raw.exec(sql),
    getFirstSync: <T>(sql: string) => (raw.prepare(sql).get() as T | undefined) ?? null,
    withTransactionSync(fn: () => void) {
      raw.exec("BEGIN");
      try {
        fn();
        raw.exec("COMMIT");
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
    getAllAsync: async <T>(sql: string, ...params: unknown[]) => raw.prepare(sql).all(...args(params)) as T[],
    getFirstAsync: async <T>(sql: string, ...params: unknown[]) =>
      (raw.prepare(sql).get(...args(params)) as T | undefined) ?? null,
    runAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).run(...args(params)),
    async withExclusiveTransactionAsync(fn: (tx: LocalDb) => Promise<void>) {
      raw.exec("BEGIN EXCLUSIVE");
      try {
        await fn(adapter as unknown as LocalDb);
        raw.exec("COMMIT");
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
  };

  migrate(adapter);
  return adapter as unknown as LocalDb;
}
