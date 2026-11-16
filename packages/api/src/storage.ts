import type { MediaKind } from "@rejsedagbog/shared";

/**
 * Udbyder-neutral adgang til billedlageret. Serveren implementerer den med
 * AWS SDK v3 mod en S3-kompatibel bucket (apps/server/src/storage.ts).
 */
export interface MediaStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Tidsbegrænset, signeret GET-URL til et privat objekt. */
  signedGetUrl(key: string): Promise<string>;
  delete(keys: string[]): Promise<void>;
}

/**
 * Objektnøgler: trips/{tripId}/{mediaId}.jpg (eller .mp4 for video) og
 * trips/{tripId}/{mediaId}_thumb.jpg. For en video er "thumb" plakatrammen.
 */
export function mediaKeys(tripId: string, mediaId: string, kind: MediaKind = "photo") {
  return {
    key: `trips/${tripId}/${mediaId}.${kind === "video" ? "mp4" : "jpg"}`,
    thumbKey: `trips/${tripId}/${mediaId}_thumb.jpg`,
  };
}
