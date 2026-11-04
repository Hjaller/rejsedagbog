import * as SQLite from "expo-sqlite";

import { migrate } from "./migrations";
import type { LocalDb } from "./types";

/**
 * Lokal SQLite-database. Én fil pr. bruger, så to konti på samme telefon aldrig ser
 * hinandens indlæg. Migrationer styres med PRAGMA user_version.
 */

const open = new Map<string, SQLite.SQLiteDatabase>();

/** Åbner (og migrerer) brugerens database. Synkron, så den kan bruges ved opstart og i upload-køen. */
export function getLocalDb(userId: string): LocalDb {
  const name = `rejsepost-${userId.replace(/[^a-zA-Z0-9_-]/g, "")}.db`;
  let db = open.get(name);
  if (!db) {
    db = SQLite.openDatabaseSync(name);
    migrate(db);
    open.set(name, db);
  }
  return db;
}

export type { LocalDb } from "./types";
