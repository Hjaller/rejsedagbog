/**
 * Den del af expo-sqlites SQLiteDatabase, som repo- og synkroniseringskoden bruger.
 * Holdt fri for expo-/React Native-typer, så den samme kode kan testes i Node
 * (apps/server/test/local-sqlite.ts). expo-sqlites SQLiteDatabase opfylder den.
 */
export type BindValue = string | number | null;

export interface LocalDb {
  getAllAsync<T>(sql: string, ...params: BindValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: BindValue[]): Promise<T | null>;
  runAsync(sql: string, ...params: BindValue[]): Promise<unknown>;
  withExclusiveTransactionAsync(task: (txn: LocalDb) => Promise<void>): Promise<void>;
  prepareAsync(sql: string): Promise<{
    executeAsync(...params: BindValue[]): Promise<unknown>;
    finalizeAsync(): Promise<void>;
  }>;
}
