import type { AppRouter } from "@rejsedagbog/api/routers/index";
import { TRPCClientError, type TRPCClient } from "@trpc/client";

// Relative imports, så filen også kan køres af serverens testsuite.
import type { LocalDb } from "../local-db/types";
import {
  deleteTripsMissingOnServer,
  listSyncedTripIds,
  listUnsyncedTrips,
  listUploadQueue,
  markMediaUploaded,
  markPostFailed,
  markPostSynced,
  markPostUploading,
  markTripFailed,
  mergeServerPosts,
  requeuePost,
  upsertTripFromServer,
} from "../local-db/sync-repo";

/**
 * Upload-køen (udviklingsplan afsnit 3):
 *  1. rejser oprettet offline sendes til serveren (idempotent upsert på UUID)
 *  2. indlæg uploades ét ad gangen: billede → posts.create → status "synkroniseret"
 *  3. rejser og andres indlæg hentes og flettes ind i SQLite
 * Netværksfejl stopper kørslen uden at tælle forsøg; serverfejl giver backoff.
 *
 * Filen har ingen React Native-afhængigheder; de gives ind som SyncDeps
 * (se native-deps.ts), så motoren kan testes end-to-end i Node.
 */

export type SyncOptions = {
  /** Hent rejser og indlæg fra serveren (ellers kun upload). */
  pull: boolean;
  /** Ignorér backoff, fx når nettet lige er kommet tilbage eller brugeren trykker "synkronisér". */
  ignoreBackoff: boolean;
};

export type SyncResult = { uploaded: number; failed: number; pulledChanges: number; offline: boolean };

export type SyncDeps = {
  api: TRPCClient<AppRouter>;
  /** POST /api/uploads. Skal kaste OfflineError ved netværksfejl og AuthError ved 401. */
  uploadImage(args: { tripId: string; mediaId: string; localUri: string }): Promise<void>;
  fileExists(uri: string): boolean;
  deleteFile(uri: string): void;
  /** Gør relative medie-URL'er (lokal udviklingslagring) absolutte. */
  resolveMediaUrl(url: string | null): string | null;
};

export class OfflineError extends Error {}
export class AuthError extends Error {}

/** Lokal udviklingslagring giver relative URL'er (/api/media/...). */
export function mediaUrlResolver(serverUrl: string) {
  const base = serverUrl.replace(/\/$/, "");
  return (url: string | null) => (!url ? null : url.startsWith("/") ? `${base}${url}` : url);
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TRPCClientError) return !err.data; // intet svar fra serveren
  return err instanceof TypeError; // fetch: "Network request failed"
}

function httpStatus(err: unknown): number | undefined {
  if (err instanceof TRPCClientError) return (err.data as { httpStatus?: number } | undefined)?.httpStatus;
  return undefined;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Kører et kald og oversætter fejl til Offline/Auth, så kørslen kan stoppe tidligt. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OfflineError || err instanceof AuthError) throw err;
    if (isNetworkError(err)) throw new OfflineError(errorMessage(err));
    if (httpStatus(err) === 401) throw new AuthError("Ikke logget ind");
    throw err;
  }
}

async function pushTrips(deps: SyncDeps, db: LocalDb) {
  for (const trip of await listUnsyncedTrips(db)) {
    try {
      const dto = await call(() =>
        deps.api.trips.create.mutate({
          id: trip.id,
          name: trip.name,
          countryCode: trip.countryCode,
          startDate: trip.startDate,
          endDate: trip.endDate,
        }),
      );
      await upsertTripFromServer(db, dto);
    } catch (err) {
      if (err instanceof OfflineError || err instanceof AuthError) throw err;
      await markTripFailed(db, trip.id, errorMessage(err));
    }
  }
}

async function pushPosts(deps: SyncDeps, db: LocalDb, opts: SyncOptions) {
  let uploaded = 0;
  let failed = 0;
  for (const post of await listUploadQueue(db, { ignoreBackoff: opts.ignoreBackoff })) {
    await markPostUploading(db, post.id);
    try {
      // Ét billede pr. indlæg: billedets id = indlæggets id, så et retry er idempotent.
      let mediaId = post.remoteMediaId;
      if (post.localImageUri && !mediaId) {
        if (!deps.fileExists(post.localImageUri)) {
          throw new Error("Billedfilen findes ikke længere på telefonen");
        }
        await call(() => deps.uploadImage({ tripId: post.tripId, mediaId: post.id, localUri: post.localImageUri! }));
        mediaId = post.id;
        await markMediaUploaded(db, post.id, mediaId);
      }
      const dto = await call(() =>
        deps.api.posts.create.mutate({
          id: post.id,
          tripId: post.tripId,
          text: post.text,
          takenAt: post.takenAt,
          lat: post.lat,
          lon: post.lon,
          mediaId,
        }),
      );
      await markPostSynced(db, dto, deps.resolveMediaUrl);
      uploaded++;
    } catch (err) {
      if (err instanceof OfflineError || err instanceof AuthError) {
        await requeuePost(db, post.id);
        throw err;
      }
      failed++;
      console.warn(`[sync] indlæg ${post.id} fejlede:`, errorMessage(err));
      await markPostFailed(db, post.id, post.attempts + 1, errorMessage(err));
    }
  }
  return { uploaded, failed };
}

async function pull(deps: SyncDeps, db: LocalDb) {
  const trips = await call(() => deps.api.trips.list.query());
  for (const t of trips) await upsertTripFromServer(db, t);
  let changes = await deleteTripsMissingOnServer(
    db,
    trips.map((t) => t.id),
  );
  const orphanedFiles: string[] = [];
  // Hele listen hentes (ikke kun `since`), fordi de signerede billed-URL'er udløber efter 15 min.
  for (const tripId of await listSyncedTripIds(db)) {
    const posts = await call(() => deps.api.posts.list.query({ tripId }));
    const merged = await mergeServerPosts(db, tripId, posts, deps.resolveMediaUrl);
    changes += merged.changed;
    orphanedFiles.push(...merged.orphanedFiles);
  }
  return { changes, orphanedFiles };
}

export async function runSyncWith(deps: SyncDeps, db: LocalDb, opts: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = { uploaded: 0, failed: 0, pulledChanges: 0, offline: false };
  try {
    await pushTrips(deps, db);
    const pushed = await pushPosts(deps, db, opts);
    result.uploaded = pushed.uploaded;
    result.failed = pushed.failed;
    if (opts.pull) {
      const pulled = await pull(deps, db);
      result.pulledChanges = pulled.changes;
      for (const uri of pulled.orphanedFiles) {
        try {
          if (deps.fileExists(uri)) deps.deleteFile(uri);
        } catch {
          // Ikke kritisk.
        }
      }
    }
  } catch (err) {
    if (err instanceof OfflineError) {
      result.offline = true;
      return result;
    }
    throw err;
  }
  return result;
}
