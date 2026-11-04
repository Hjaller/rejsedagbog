import type { MediaDto, PostDto, TripDto } from "@rejsedagbog/api/routers/index";

import type { LocalDb } from "./types";
import type { LocalPost, LocalTrip } from "./repo";

/**
 * Databaseoperationer til upload-køen og hentning fra serveren (udviklingsplan afsnit 3).
 */

// ---------------------------------------------------------------------------
// Rejser
// ---------------------------------------------------------------------------

export function listUnsyncedTrips(db: LocalDb): Promise<LocalTrip[]> {
  return db.getAllAsync<LocalTrip>("SELECT * FROM trips WHERE syncStatus != 'synkroniseret' ORDER BY createdAt");
}

export async function markTripFailed(db: LocalDb, tripId: string, error: string) {
  await db.runAsync("UPDATE trips SET syncStatus = 'fejl', lastError = ? WHERE id = ?", error, tripId);
}

/** Indsætter eller opdaterer en rejse med serverens data og markerer den som synkroniseret. */
export async function upsertTripFromServer(db: LocalDb, t: TripDto) {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO trips (id, name, countryCode, startDate, endDate, role, memberCount, inviteCode, syncStatus, lastError, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synkroniseret', NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, countryCode = excluded.countryCode, startDate = excluded.startDate,
       endDate = excluded.endDate, role = excluded.role, memberCount = excluded.memberCount,
       inviteCode = excluded.inviteCode, syncStatus = 'synkroniseret', lastError = NULL,
       updatedAt = excluded.updatedAt`,
    t.id,
    t.name,
    t.countryCode,
    t.startDate,
    t.endDate,
    t.role,
    t.memberCount,
    t.inviteCode,
    now,
    t.updatedAt,
  );
}

/** Fjerner synkroniserede rejser, som serveren ikke længere kender (slettet eller forladt). */
export async function deleteTripsMissingOnServer(db: LocalDb, serverIds: string[]): Promise<number> {
  const local = await db.getAllAsync<{ id: string }>("SELECT id FROM trips WHERE syncStatus = 'synkroniseret'");
  const keep = new Set(serverIds);
  const gone = local.filter((t) => !keep.has(t.id));
  for (const t of gone) await db.runAsync("DELETE FROM trips WHERE id = ?", t.id);
  return gone.length;
}

// ---------------------------------------------------------------------------
// Upload-kø
// ---------------------------------------------------------------------------

type QueueRow = Pick<
  LocalPost,
  "id" | "tripId" | "text" | "takenAt" | "lat" | "lon" | "localImageUri" | "remoteMediaId" | "attempts"
>;

/**
 * Indlæg, der venter på upload, og hvis backoff er udløbet. "uploader" tages med,
 * fordi appen kan være blevet lukket midt i en upload. Kun rejser, der findes på serveren.
 */
export function listUploadQueue(db: LocalDb, opts: { ignoreBackoff: boolean }): Promise<QueueRow[]> {
  return db.getAllAsync<QueueRow>(
    `SELECT p.id, p.tripId, p.text, p.takenAt, p.lat, p.lon, p.localImageUri, p.remoteMediaId, p.attempts
       FROM posts p JOIN trips t ON t.id = p.tripId
      WHERE p.syncStatus != 'synkroniseret' AND p.deletedAt IS NULL
        AND t.syncStatus = 'synkroniseret'
        AND (? = 1 OR p.nextAttemptAt IS NULL OR p.nextAttemptAt <= ?)
      ORDER BY p.createdAt`,
    opts.ignoreBackoff ? 1 : 0,
    new Date().toISOString(),
  );
}

export async function markPostUploading(db: LocalDb, postId: string) {
  await db.runAsync("UPDATE posts SET syncStatus = 'uploader' WHERE id = ?", postId);
}

/** Gemmer at billedet er uploadet, så et retry kun mangler posts.create. */
export async function markMediaUploaded(db: LocalDb, postId: string, mediaId: string) {
  await db.runAsync("UPDATE posts SET remoteMediaId = ? WHERE id = ?", mediaId, postId);
}

/** Netværksfejl: tilbage i køen uden at tælle forsøg, så det prøves igen, når nettet er tilbage. */
export async function requeuePost(db: LocalDb, postId: string) {
  await db.runAsync(
    "UPDATE posts SET syncStatus = CASE WHEN attempts > 0 THEN 'fejl' ELSE 'lokal' END WHERE id = ?",
    postId,
  );
}

/** Serverfejl: tæl forsøget og vent eksponentielt længere (15 s, 30 s, 1 min … maks. 30 min). */
export async function markPostFailed(db: LocalDb, postId: string, attempts: number, error: string) {
  const delayMs = Math.min(30 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));
  await db.runAsync(
    "UPDATE posts SET syncStatus = 'fejl', attempts = ?, lastError = ?, nextAttemptAt = ? WHERE id = ?",
    attempts,
    error,
    new Date(Date.now() + delayMs).toISOString(),
    postId,
  );
}

// ---------------------------------------------------------------------------
// Indlæg fra serveren
// ---------------------------------------------------------------------------

function mediaUrls(media: MediaDto[], resolveUrl: (u: string | null) => string | null) {
  const m = media[0];
  return { url: resolveUrl(m?.url ?? null), thumbUrl: resolveUrl(m?.thumbUrl ?? null) };
}

/** Opdaterer et indlæg med serverens berigede data (sted, vejr, land) efter upload. */
export async function markPostSynced(db: LocalDb, dto: PostDto, resolveUrl: (u: string | null) => string | null) {
  const { url, thumbUrl } = mediaUrls(dto.media, resolveUrl);
  await db.runAsync(
    `UPDATE posts SET syncStatus = 'synkroniseret', lastError = NULL, attempts = 0, nextAttemptAt = NULL,
       placeName = COALESCE(?, placeName), weatherJson = COALESCE(?, weatherJson),
       countryCode = COALESCE(?, countryCode), remoteImageUrl = ?, remoteThumbUrl = ?,
       remoteMediaId = COALESCE(?, remoteMediaId), updatedAt = ?
     WHERE id = ?`,
    dto.placeName,
    dto.weather ? JSON.stringify(dto.weather) : null,
    dto.countryCode,
    url,
    thumbUrl,
    dto.media[0]?.id ?? null,
    dto.updatedAt,
    dto.id,
  );
}

/**
 * Fletter rejsens indlæg fra serveren ind i SQLite. Egne indlæg, der endnu ikke er
 * uploadet, røres ikke. Returnerer filstier på lokale billeder, der kan slettes.
 */
export async function mergeServerPosts(
  db: LocalDb,
  tripId: string,
  posts: PostDto[],
  resolveUrl: (u: string | null) => string | null,
): Promise<{ changed: number; orphanedFiles: string[] }> {
  let changed = 0;
  const orphanedFiles: string[] = [];
  const local = await db.getAllAsync<{ id: string; syncStatus: string; updatedAt: string; localImageUri: string | null }>(
    "SELECT id, syncStatus, updatedAt, localImageUri FROM posts WHERE tripId = ?",
    tripId,
  );
  const localById = new Map(local.map((p) => [p.id, p]));
  const serverIds = new Set(posts.map((p) => p.id));

  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const dto of posts) {
      const existing = localById.get(dto.id);
      if (existing && existing.syncStatus !== "synkroniseret") continue;
      const { url, thumbUrl } = mediaUrls(dto.media, resolveUrl);
      if (!existing) changed++;
      else if (existing.updatedAt !== dto.updatedAt) changed++;
      // URL'erne skrives altid, fordi de signerede links udløber.
      await tx.runAsync(
        `INSERT INTO posts (id, tripId, authorId, authorName, text, takenAt, lat, lon, placeName, weatherJson,
                            countryCode, remoteMediaId, remoteImageUrl, remoteThumbUrl, syncStatus, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synkroniseret', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           authorName = excluded.authorName, text = excluded.text, takenAt = excluded.takenAt,
           lat = excluded.lat, lon = excluded.lon, placeName = excluded.placeName,
           weatherJson = excluded.weatherJson, countryCode = excluded.countryCode,
           remoteMediaId = excluded.remoteMediaId, remoteImageUrl = excluded.remoteImageUrl,
           remoteThumbUrl = excluded.remoteThumbUrl, updatedAt = excluded.updatedAt`,
        dto.id,
        dto.tripId,
        dto.author.id,
        dto.author.name,
        dto.text,
        dto.takenAt,
        dto.lat,
        dto.lon,
        dto.placeName,
        dto.weather ? JSON.stringify(dto.weather) : null,
        dto.countryCode,
        dto.media[0]?.id ?? null,
        url,
        thumbUrl,
        dto.createdAt,
        dto.updatedAt,
      );
    }
    // Synkroniserede indlæg, som ikke længere er på serveren, er slettet et andet sted.
    for (const p of local) {
      if (p.syncStatus === "synkroniseret" && !serverIds.has(p.id)) {
        await tx.runAsync("DELETE FROM posts WHERE id = ?", p.id);
        if (p.localImageUri) orphanedFiles.push(p.localImageUri);
        changed++;
      }
    }
  });
  return { changed, orphanedFiles };
}

export async function listSyncedTripIds(db: LocalDb): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>("SELECT id FROM trips WHERE syncStatus = 'synkroniseret'");
  return rows.map((r) => r.id);
}
