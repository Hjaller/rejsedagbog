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

/** Objektnøgler: trips/{tripId}/{mediaId}.jpg og trips/{tripId}/{mediaId}_thumb.jpg */
export function mediaKeys(tripId: string, mediaId: string) {
  return {
    key: `trips/${tripId}/${mediaId}.jpg`,
    thumbKey: `trips/${tripId}/${mediaId}_thumb.jpg`,
  };
}
