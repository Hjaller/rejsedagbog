import type { CountryFacts, InviteAccess, MediaKind, SyncStatus, TripRole, Weather } from "@rejsedagbog/shared";

import type { LocalDb } from "./types";

// ---------------------------------------------------------------------------
// Typer
// ---------------------------------------------------------------------------

export type LocalTrip = {
  id: string;
  name: string;
  /** Rejsens lande i den rækkefølge, de besøges. Mindst ét. */
  countryCodes: string[];
  startDate: string;
  endDate: string;
  /** "viewer": rejsen er delt med brugeren, som kun kan se den. */
  role: TripRole;
  memberCount: number;
  inviteCode: string | null;
  /** Koden til deling (kun visning). Kun ejeren har den. */
  viewCode: string | null;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
};

/** Rækken i SQLite, hvor landene står som "IT,FR,ES". */
export type TripRow = Omit<LocalTrip, "countryCodes"> & { countryCodes: string };

export const toTrip = (row: TripRow): LocalTrip => ({
  ...row,
  countryCodes: row.countryCodes.split(",").filter(Boolean),
});

/** Må brugeren lægge indlæg op på rejsen? Ikke, når den kun er delt til visning. */
export const canPost = (trip: Pick<LocalTrip, "role">) => trip.role !== "viewer";

/** Landet til et indlæg uden position: kendes kun, når rejsen har ét land. */
export const singleCountry = (trip: Pick<LocalTrip, "countryCodes">): string | null =>
  trip.countryCodes.length === 1 ? trip.countryCodes[0]! : null;

export type LocalPost = {
  id: string;
  tripId: string;
  authorId: string;
  authorName: string;
  text: string;
  takenAt: string;
  lat: number | null;
  lon: number | null;
  placeName: string | null;
  weather: Weather | null;
  countryCode: string | null;
  /** "video" (Could) eller "photo". */
  mediaKind: MediaKind;
  /** Billedet eller videoen i appens dokumentmappe (egne indlæg). */
  localImageUri: string | null;
  /** Plakatrammen til en egen video (lavet i appen, så den kan vises offline). */
  localThumbUri: string | null;
  /** Videoens længde. */
  durationMs: number | null;
  remoteMediaId: string | null;
  /** Signeret URL fra serveren (andres indlæg): billedet eller videoen. */
  remoteImageUrl: string | null;
  /** Thumbnail, eller plakatrammen for en video. */
  remoteThumbUrl: string | null;
  syncStatus: SyncStatus;
  lastError: string | null;
  attempts: number;
  /** Lokal ændring, der endnu ikke er sendt til serveren. */
  pendingOp: PendingOp | null;
  createdAt: string;
  updatedAt: string;
};

export type PendingOp = "update" | "delete";

type PostRow = Omit<LocalPost, "weather"> & { weatherJson: string | null };

function parseWeather(json: string | null): Weather | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Weather;
  } catch {
    return null;
  }
}

const toPost = ({ weatherJson, ...row }: PostRow): LocalPost => ({
  ...row,
  weather: parseWeather(weatherJson),
});

export const isVideo = (post: Pick<LocalPost, "mediaKind">) => post.mediaKind === "video";

/**
 * Billedet, der skal vises: lokal fil først (virker offline), ellers serverens.
 * For en video er det plakatrammen; selve videoen giver postVideoUri.
 */
export function postImageUri(post: LocalPost, size: "full" | "thumb" = "full"): string | null {
  if (isVideo(post)) return post.localThumbUri ?? post.remoteThumbUrl;
  if (post.localImageUri) return post.localImageUri;
  return size === "thumb" ? (post.remoteThumbUrl ?? post.remoteImageUrl) : post.remoteImageUrl;
}

/** Videoen: den lokale fil (egne videoer, virker offline), ellers serverens signerede link. */
export function postVideoUri(post: LocalPost): string | null {
  if (!isVideo(post)) return null;
  return post.localImageUri ?? post.remoteImageUrl;
}

/** Filer i appens mappe, der hører til indlægget (til oprydning). */
export function localFilesOf(post: Pick<LocalPost, "localImageUri" | "localThumbUri">): string[] {
  return [post.localImageUri, post.localThumbUri].filter((u): u is string => !!u);
}

/**
 * Kilde til expo-image. Serverens signerede URL'er skifter ved hver hentning, så
 * billedet caches på en fast nøgle – ellers hentes det igen over mobildata hver gang,
 * og det kan stadig vises fra cachen, når linket er udløbet eller telefonen er offline.
 */
export function postImageSource(
  post: LocalPost,
  size: "full" | "thumb" = "full",
): { uri: string; cacheKey?: string } | null {
  const uri = postImageUri(post, size);
  if (!uri) return null;
  if (isVideo(post)) return uri === post.localThumbUri ? { uri } : { uri, cacheKey: `${post.id}-poster` };
  if (post.localImageUri) return { uri };
  const usingThumb = size === "thumb" && !!post.remoteThumbUrl;
  return { uri, cacheKey: `${post.id}-${usingThumb ? "thumb" : "full"}` };
}

// ---------------------------------------------------------------------------
// Rejser
// ---------------------------------------------------------------------------

export async function listTrips(db: LocalDb): Promise<LocalTrip[]> {
  const rows = await db.getAllAsync<TripRow>("SELECT * FROM trips ORDER BY startDate DESC, createdAt DESC");
  return rows.map(toTrip);
}

export async function getTrip(db: LocalDb, id: string): Promise<LocalTrip | null> {
  const row = await db.getFirstAsync<TripRow>("SELECT * FROM trips WHERE id = ?", id);
  return row ? toTrip(row) : null;
}

/**
 * Gemmer den kode, serveren har lavet eller fjernet (kun ejeren ser den):
 * invitationskoden ("member") eller koden til deling ("viewer").
 */
export async function setTripInviteCode(
  db: LocalDb,
  tripId: string,
  access: InviteAccess,
  code: string | null,
): Promise<void> {
  const sql =
    access === "viewer" ? "UPDATE trips SET viewCode = ? WHERE id = ?" : "UPDATE trips SET inviteCode = ? WHERE id = ?";
  await db.runAsync(sql, code, tripId);
}

/** Antal i gruppen fra serveren, så "N i gruppen" passer, når medlemslisten er hentet. */
export async function setTripMemberCount(db: LocalDb, tripId: string, count: number): Promise<boolean> {
  const row = await db.getFirstAsync<{ memberCount: number }>("SELECT memberCount FROM trips WHERE id = ?", tripId);
  if (!row || row.memberCount === count) return false;
  await db.runAsync("UPDATE trips SET memberCount = ? WHERE id = ?", count, tripId);
  return true;
}

export async function insertTrip(
  db: LocalDb,
  trip: Pick<LocalTrip, "id" | "name" | "countryCodes" | "startDate" | "endDate">,
): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO trips (id, name, countryCodes, startDate, endDate, role, memberCount, syncStatus, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 'owner', 1, 'lokal', ?, ?)`,
    trip.id,
    trip.name,
    trip.countryCodes.join(","),
    trip.startDate,
    trip.endDate,
    now,
    now,
  );
}

// ---------------------------------------------------------------------------
// Indlæg
// ---------------------------------------------------------------------------

/** Indlæggene på én rejse, eller på alle brugerens rejser, når `tripId` er null. */
export async function listPosts(db: LocalDb, tripId: string | null): Promise<LocalPost[]> {
  const rows = tripId
    ? await db.getAllAsync<PostRow>(
        "SELECT * FROM posts WHERE tripId = ? AND deletedAt IS NULL ORDER BY takenAt DESC",
        tripId,
      )
    : await db.getAllAsync<PostRow>("SELECT * FROM posts WHERE deletedAt IS NULL ORDER BY takenAt DESC");
  return rows.map(toPost);
}

export async function getPost(db: LocalDb, id: string): Promise<LocalPost | null> {
  const row = await db.getFirstAsync<PostRow>(
    "SELECT * FROM posts WHERE id = ? AND deletedAt IS NULL",
    id,
  );
  return row ? toPost(row) : null;
}

export type NewLocalPost = Pick<
  LocalPost,
  | "id"
  | "tripId"
  | "authorId"
  | "authorName"
  | "text"
  | "takenAt"
  | "lat"
  | "lon"
  | "placeName"
  | "weather"
  | "countryCode"
  | "localImageUri"
> &
  Partial<Pick<LocalPost, "mediaKind" | "localThumbUri" | "durationMs">>;

/** Gemmes altid først lokalt med status "lokal" – også når der er net (udviklingsplan afsnit 3). */
export async function insertPost(db: LocalDb, post: NewLocalPost): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO posts (id, tripId, authorId, authorName, text, takenAt, lat, lon, placeName, weatherJson,
                        countryCode, localImageUri, mediaKind, localThumbUri, durationMs, syncStatus, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lokal', ?, ?)`,
    post.id,
    post.tripId,
    post.authorId,
    post.authorName,
    post.text,
    post.takenAt,
    post.lat,
    post.lon,
    post.placeName,
    post.weather ? JSON.stringify(post.weather) : null,
    post.countryCode,
    post.localImageUri,
    post.mediaKind ?? "photo",
    post.localThumbUri ?? null,
    post.durationMs ?? null,
    now,
    now,
  );
}

/**
 * Retter teksten på et af brugerens egne indlæg. Gemmes lokalt med det samme, også
 * offline; upload-køen sender rettelsen (posts.update), når indlægget er på serveren.
 */
export async function updatePostText(db: LocalDb, postId: string, text: string): Promise<void> {
  await db.runAsync(
    `UPDATE posts SET text = ?, updatedAt = ?, pendingOp = 'update'
      WHERE id = ? AND deletedAt IS NULL`,
    text,
    new Date().toISOString(),
    postId,
  );
}

/**
 * Sætter positionen på et af brugerens egne indlæg (fx et billede fra albummet uden
 * GPS). Sted og vejr nulstilles; serveren finder dem ud fra den nye position, når
 * indlægget eller rettelsen sendes.
 */
export async function updatePostPosition(
  db: LocalDb,
  postId: string,
  coords: { lat: number; lon: number },
): Promise<void> {
  await db.runAsync(
    `UPDATE posts SET lat = ?, lon = ?, placeName = NULL, weatherJson = NULL, updatedAt = ?, pendingOp = 'update'
      WHERE id = ? AND deletedAt IS NULL`,
    coords.lat,
    coords.lon,
    new Date().toISOString(),
    postId,
  );
}

/**
 * Sletter et af brugerens egne indlæg. Det forsvinder fra skærmene med det samme;
 * rækken bliver liggende, indtil upload-køen har slettet det på serveren (posts.delete)
 * – også hvis det aldrig nåede derop, for et svar kan være gået tabt undervejs.
 */
export async function markPostDeleted(db: LocalDb, postId: string): Promise<void> {
  await db.runAsync(
    "UPDATE posts SET deletedAt = ?, pendingOp = 'delete' WHERE id = ? AND deletedAt IS NULL",
    new Date().toISOString(),
    postId,
  );
}

/** Antal indlæg (og rettelser), der endnu ikke er på serveren (til "N venter på upload"). */
export async function countPending(db: LocalDb, tripId?: string): Promise<number> {
  const where =
    "deletedAt IS NULL AND (syncStatus != 'synkroniseret' OR pendingOp IS NOT NULL)";
  const row = tripId
    ? await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM posts WHERE ${where} AND tripId = ?`, tripId)
    : await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM posts WHERE ${where}`);
  return row?.n ?? 0;
}

export async function countPostsByTrip(db: LocalDb): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ tripId: string; n: number }>(
    "SELECT tripId, COUNT(*) AS n FROM posts WHERE deletedAt IS NULL GROUP BY tripId",
  );
  return Object.fromEntries(rows.map((r) => [r.tripId, r.n]));
}

// ---------------------------------------------------------------------------
// Landefakta (cache af REST Countries via serveren)
// ---------------------------------------------------------------------------

export async function getCountryFacts(db: LocalDb, code: string): Promise<CountryFacts | null> {
  const row = await db.getFirstAsync<{
    code: string;
    currencies: string;
    languages: string;
    capital: string | null;
  }>("SELECT code, currencies, languages, capital FROM countries WHERE code = ?", code);
  if (!row) return null;
  return {
    code: row.code,
    currencies: JSON.parse(row.currencies) as string[],
    languages: JSON.parse(row.languages) as string[],
    capital: row.capital,
  };
}

export async function replaceCountryFacts(db: LocalDb, facts: CountryFacts[]): Promise<void> {
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const stmt = await tx.prepareAsync(
      "INSERT OR REPLACE INTO countries (code, currencies, languages, capital, updatedAt) VALUES (?, ?, ?, ?, ?)",
    );
    try {
      for (const f of facts) {
        await stmt.executeAsync(
          f.code,
          JSON.stringify(f.currencies),
          JSON.stringify(f.languages),
          f.capital,
          now,
        );
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
  await setMeta(db, "countriesFetchedAt", now);
}

// ---------------------------------------------------------------------------
// Meta (aktiv rejse m.m.)
// ---------------------------------------------------------------------------

export async function getMeta(db: LocalDb, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>("SELECT value FROM meta WHERE key = ?", key);
  return row?.value ?? null;
}

export async function setMeta(db: LocalDb, key: string, value: string | null): Promise<void> {
  await db.runAsync("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
}
