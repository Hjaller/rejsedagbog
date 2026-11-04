import { File } from "expo-file-system";

import { authClient } from "@/lib/auth-client";
import type { LocalDb } from "@/lib/local-db/database";
import { trpcClient } from "@/utils/trpc";

import { ENV } from "../../src/env";
import {
  AuthError,
  errorMessage,
  mediaUrlResolver,
  OfflineError,
  runSyncWith,
  type SyncDeps,
  type SyncOptions,
} from "./sync-engine";

const serverUrl = ENV.EXPO_PUBLIC_SERVER_URL.replace(/\/$/, "");

/** Upload med React Natives FormData, som tager { uri, name, type } for filer. */
async function uploadImage({ tripId, mediaId, localUri }: { tripId: string; mediaId: string; localUri: string }) {
  const form = new FormData();
  form.append("tripId", tripId);
  form.append("mediaId", mediaId);
  form.append("file", { uri: localUri, name: `${mediaId}.jpg`, type: "image/jpeg" } as unknown as Blob);

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
    throw new OfflineError(errorMessage(err));
  }
  if (res.status === 401) throw new AuthError("Ikke logget ind");
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Upload fejlede (${res.status})`);
  }
}

export const nativeSyncDeps: SyncDeps = {
  api: trpcClient,
  uploadImage,
  fileExists: (uri) => new File(uri).exists,
  deleteFile: (uri) => new File(uri).delete(),
  resolveMediaUrl: mediaUrlResolver(serverUrl),
};

export const resolveMediaUrl = nativeSyncDeps.resolveMediaUrl;

export function runSync(db: LocalDb, opts: SyncOptions) {
  return runSyncWith(nativeSyncDeps, db, opts);
}
