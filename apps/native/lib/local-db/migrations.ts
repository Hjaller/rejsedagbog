/**
 * Skemaet for appens lokale SQLite-database. Holdt fri for expo-sqlite, så
 * synkroniseringstestene kan køre det samme skema i Node (node:sqlite).
 */

/** Den del af en synkron SQLite-forbindelse, som migrationerne bruger. */
export type MigratableDb = {
  execSync(sql: string): void;
  getFirstSync<T>(sql: string): T | null;
  withTransactionSync(fn: () => void): void;
};

export const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE trips (
    id            TEXT PRIMARY KEY NOT NULL,
    name          TEXT NOT NULL,
    countryCode   TEXT NOT NULL,
    startDate     TEXT NOT NULL,
    endDate       TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'owner',
    memberCount   INTEGER NOT NULL DEFAULT 1,
    inviteCode    TEXT,
    syncStatus    TEXT NOT NULL DEFAULT 'lokal',
    lastError     TEXT,
    createdAt     TEXT NOT NULL,
    updatedAt     TEXT NOT NULL
  );

  CREATE TABLE posts (
    id             TEXT PRIMARY KEY NOT NULL,
    tripId         TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    authorId       TEXT NOT NULL,
    authorName     TEXT NOT NULL,
    text           TEXT NOT NULL DEFAULT '',
    takenAt        TEXT NOT NULL,
    lat            REAL,
    lon            REAL,
    placeName      TEXT,
    weatherJson    TEXT,
    countryCode    TEXT,
    localImageUri  TEXT,
    remoteMediaId  TEXT,
    remoteImageUrl TEXT,
    remoteThumbUrl TEXT,
    syncStatus     TEXT NOT NULL DEFAULT 'lokal',
    lastError      TEXT,
    attempts       INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt  TEXT,
    createdAt      TEXT NOT NULL,
    updatedAt      TEXT NOT NULL,
    deletedAt      TEXT
  );
  CREATE INDEX posts_trip_taken ON posts (tripId, takenAt DESC);
  CREATE INDEX posts_sync ON posts (syncStatus);

  CREATE TABLE countries (
    code       TEXT PRIMARY KEY NOT NULL,
    currencies TEXT NOT NULL,
    languages  TEXT NOT NULL,
    capital    TEXT,
    updatedAt  TEXT NOT NULL
  );

  CREATE TABLE meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );
  `,
  // v2: redigering og sletning af egne indlæg (Should). En ændring gemmes lokalt
  // med det samme og sendes til serveren af upload-køen: 'update' | 'delete' | NULL.
  `
  ALTER TABLE posts ADD COLUMN pendingOp TEXT;
  CREATE INDEX posts_pending_op ON posts (pendingOp) WHERE pendingOp IS NOT NULL;
  `,
  // v3: video (Could). For en video er localImageUri/remoteImageUrl selve videoen, og
  // localThumbUri/remoteThumbUrl plakatrammen, som vises i lister og på kortet.
  `
  ALTER TABLE posts ADD COLUMN mediaKind TEXT NOT NULL DEFAULT 'photo';
  ALTER TABLE posts ADD COLUMN localThumbUri TEXT;
  ALTER TABLE posts ADD COLUMN durationMs INTEGER;
  `,
];

export function migrate(db: MigratableDb) {
  db.execSync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const row = db.getFirstSync<{ user_version: number }>("PRAGMA user_version");
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.withTransactionSync(() => {
      db.execSync(MIGRATIONS[v]!);
      db.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
