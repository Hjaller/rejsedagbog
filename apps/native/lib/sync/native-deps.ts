import { File } from "expo-file-system";

import { authClient } from "@/lib/auth-client";
import type { LocalDb } from "@/lib/local-db/database";
import { trpcClient } from "@/utils/trpc";

import { ENV } from "../../src/env";
import {
  AuthError,
  errorMessage,
  isFetchFailure,
  mediaUrlResolver,
  OfflineError,
  runSyncWith,
  type SyncDeps,
  type SyncOptions,
} from "./sync-engine";

const serverUrl = ENV.EXPO_PUBLIC_SERVER_URL.replace(/\/$/, "");

/**
 * Expos fetch accepterer ikke React Natives { uri, name, type } i FormData
 * ("Unsupported FormDataPart implementation"), kun objekter med bytes() som File.
 * Felterne sendes før filen, så serveren ved, om det er en video, når filen kommer.
 */
const uploadMedia: SyncDeps["uploadMedia"] = async ({ tripId, mediaId, localUri, kind }) => {
  const form = new FormData();
  form.append("tripId", tripId);
  form.append("mediaId", mediaId);
  form.append("kind", kind);
  form.append("file", new File(localUri));

  const cookie = await authClient.getCookie();
  let res: Response;
  try {
    res = await fetch(`${serverUrl}/api/uploads`, {
      method: "POST",
      body: form,
      headers: cookie ? { Cookie: cookie } : undefined,
      credentials: "omit",
    });
  } catch (err) {
    if (isFetchFailure(err)) throw new OfflineError(errorMessage(err));
    throw err;
  }
  if (res.status === 401) throw new AuthError("Ikke logget ind");
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Upload fejlede (${res.status})`);
  }
};

export const nativeSyncDeps: SyncDeps = {
  api: trpcClient,
  uploadMedia,
  fileExists: (uri) => new File(uri).exists,
  deleteFile: (uri) => new File(uri).delete(),
  resolveMediaUrl: mediaUrlResolver(serverUrl),
};

export const resolveMediaUrl = nativeSyncDeps.resolveMediaUrl;

export function runSync(db: LocalDb, opts: SyncOptions) {
  return runSyncWith(nativeSyncDeps, db, opts);
}
