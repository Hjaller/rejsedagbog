import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AppRouter } from "@rejsedagbog/api/routers/index";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { insertPost, insertTrip, listPosts, type LocalPost } from "../../native/lib/local-db/repo";
import type { LocalDb } from "../../native/lib/local-db/types";
import {
  AuthError,
  OfflineError,
  runSyncWith,
  type SyncDeps,
} from "../../native/lib/sync/sync-engine";
import { createTestApp, jpegWithGps, signUp, type TestContext, type TestUser } from "./helpers";
import { createLocalSqlite } from "./local-sqlite";

/**
 * Udviklingsplanens offline-test som automatiseret test: indlæg oprettet uden net
 * ligger i køen, uploades når forbindelsen kommer, uden dubletter, og andres
 * indlæg hentes ned. Synkroniseringsmotoren er den samme kode som i appen.
 */

const DEAD_URL = "http://127.0.0.1:9"; // ingen lytter → netværksfejl ("flytilstand")

function makeDeps(baseUrl: string, user: TestUser, counters = { uploads: 0 }): SyncDeps {
  const api = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${baseUrl}/trpc`, headers: () => ({ cookie: user.cookie }) })],
  });
  return {
    api,
    async uploadImage({ tripId, mediaId, localUri }) {
      counters.uploads++;
      const form = new FormData();
      form.append("tripId", tripId);
      form.append("mediaId", mediaId);
      form.append("file", new Blob([await readFile(localUri)], { type: "image/jpeg" }), `${mediaId}.jpg`);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/api/uploads`, { method: "POST", body: form, headers: { cookie: user.cookie } });
      } catch (err) {
        throw new OfflineError(String(err));
      }
      if (res.status === 401) throw new AuthError("401");
      if (!res.ok) throw new Error(`Upload ${res.status}`);
    },
    fileExists: (uri) => existsSync(uri),
    deleteFile: () => {},
    resolveMediaUrl: (u) => u,
  };
}

describe("synkronisering (upload-kø og hentning)", () => {
  let t: TestContext;
  let baseUrl: string;
  let sara: TestUser;
  let jonas: TestUser;
  let local: LocalDb;
  let dir: string;
  const tripId = randomUUID();

  const newLocalPost = async (text: string, withImage = true): Promise<string> => {
    const id = randomUUID();
    let localImageUri: string | null = null;
    if (withImage) {
      localImageUri = path.join(dir, `${id}.jpg`);
      await writeFile(localImageUri, await jpegWithGps(800, 600));
    }
    await insertPost(local, {
      id,
      tripId,
      authorId: sara.id,
      authorName: "Sara",
      text,
      takenAt: new Date().toISOString(),
      lat: null,
      lon: null,
      placeName: null,
      weather: null,
      countryCode: "IT",
      localImageUri,
    });
    return id;
  };

  const localPost = async (id: string): Promise<LocalPost | undefined> =>
    (await listPosts(local, tripId)).find((p) => p.id === id);

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
    sara = await signUp(t.app, "Sara");
    jonas = await signUp(t.app, "Jonas");
    local = createLocalSqlite();
    dir = await mkdtemp(path.join(tmpdir(), "rejsepost-sync-"));
    await insertTrip(local, { id: tripId, name: "Rom 2026", countryCode: "IT", startDate: "2026-05-12", endDate: "2026-05-19" });
  });

  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("offline: indlæg bliver liggende i køen uden at tælle forsøg", async () => {
    await newLocalPost("Første dag");
    await newLocalPost("Pasta ved piazzaen");
    await newLocalPost("Kun tekst", false);

    const result = await runSyncWith(makeDeps(DEAD_URL, sara), local, { pull: true, ignoreBackoff: false });
    expect(result.offline).toBe(true);

    const posts = await listPosts(local, tripId);
    expect(posts).toHaveLength(3);
    expect(posts.every((p) => p.syncStatus === "lokal" && p.attempts === 0)).toBe(true);
    expect(await t.db.trip.count({ where: { id: tripId } })).toBe(0);
  });

  it("online: rejse og indlæg uploades, og billeder kobles på", async () => {
    const counters = { uploads: 0 };
    const result = await runSyncWith(makeDeps(baseUrl, sara, counters), local, { pull: true, ignoreBackoff: false });
    expect(result).toMatchObject({ offline: false, uploaded: 3, failed: 0 });
    expect(counters.uploads).toBe(2);

    const posts = await listPosts(local, tripId);
    expect(posts.every((p) => p.syncStatus === "synkroniseret")).toBe(true);
    const withImage = posts.filter((p) => p.localImageUri);
    expect(withImage.every((p) => p.remoteMediaId === p.id && p.remoteImageUrl?.startsWith("memory://"))).toBe(true);

    expect(await t.db.trip.count({ where: { id: tripId, ownerId: sara.id } })).toBe(1);
    expect(await t.db.post.count({ where: { tripId } })).toBe(3);
    expect(await t.db.media.count({ where: { tripId } })).toBe(2);
  });

  it("en ny kørsel giver ingen dubletter og uploader ikke igen", async () => {
    const counters = { uploads: 0 };
    const result = await runSyncWith(makeDeps(baseUrl, sara, counters), local, { pull: true, ignoreBackoff: true });
    expect(result.uploaded).toBe(0);
    expect(counters.uploads).toBe(0);
    expect(await t.db.post.count({ where: { tripId } })).toBe(3);
  });

  it("fejl efter billed-upload: backoff, og ved retry uploades billedet ikke igen", async () => {
    const id = await newLocalPost("Fontana di Trevi");
    const counters = { uploads: 0 };
    const deps = makeDeps(baseUrl, sara, counters);
    let failOnce = true;
    const flaky: SyncDeps = {
      ...deps,
      api: new Proxy(deps.api, {
        get(target, prop) {
          if (prop !== "posts") return Reflect.get(target, prop);
          return {
            ...target.posts,
            create: {
              mutate: async (input: Parameters<typeof target.posts.create.mutate>[0]) => {
                if (failOnce) {
                  failOnce = false;
                  throw new Error("Serveren svarede 500");
                }
                return target.posts.create.mutate(input);
              },
            },
          };
        },
      }),
    };

    const first = await runSyncWith(flaky, local, { pull: false, ignoreBackoff: false });
    expect(first.failed).toBe(1);
    let post = await localPost(id);
    expect(post).toMatchObject({ syncStatus: "fejl", attempts: 1, remoteMediaId: id });
    expect(post?.lastError).toContain("500");

    // Backoff: en almindelig kørsel lige efter springer indlægget over.
    const second = await runSyncWith(flaky, local, { pull: false, ignoreBackoff: false });
    expect(second.uploaded).toBe(0);

    const third = await runSyncWith(flaky, local, { pull: false, ignoreBackoff: true });
    expect(third.uploaded).toBe(1);
    post = await localPost(id);
    expect(post).toMatchObject({ syncStatus: "synkroniseret", attempts: 0 });
    expect(counters.uploads).toBe(1); // billedet blev kun sendt én gang
    expect(await t.db.media.count({ where: { id } })).toBe(1);
  });

  it("ugyldige indlæg markeres som fejlet uden at blokere resten af køen", async () => {
    const bad = await newLocalPost("x".repeat(501), false);
    const good = await newLocalPost("Gyldigt", false);
    const result = await runSyncWith(makeDeps(baseUrl, sara), local, { pull: false, ignoreBackoff: true });
    expect(result).toMatchObject({ uploaded: 1, failed: 1 });
    expect((await localPost(bad))?.syncStatus).toBe("fejl");
    expect((await localPost(good))?.syncStatus).toBe("synkroniseret");
    await local.runAsync("DELETE FROM posts WHERE id = ?", bad);
  });

  it("henter andres indlæg i en grupperejse og fjerner dem, når de slettes", async () => {
    await t.db.tripMember.create({ data: { tripId, userId: jonas.id, role: "member" } });
    const jonasApi = makeDeps(baseUrl, jonas).api;
    const jonasPostId = randomUUID();
    await jonasApi.posts.create.mutate({
      id: jonasPostId,
      tripId,
      text: "Mønten er kastet",
      takenAt: new Date().toISOString(),
    });

    await runSyncWith(makeDeps(baseUrl, sara), local, { pull: true, ignoreBackoff: false });
    const fetched = await localPost(jonasPostId);
    expect(fetched).toMatchObject({ authorName: "Jonas", syncStatus: "synkroniseret", text: "Mønten er kastet" });

    const trip = await local.getFirstAsync<{ memberCount: number }>("SELECT memberCount FROM trips WHERE id = ?", tripId);
    expect(trip?.memberCount).toBe(2);

    await jonasApi.posts.delete.mutate({ tripId, postId: jonasPostId });
    await runSyncWith(makeDeps(baseUrl, sara), local, { pull: true, ignoreBackoff: false });
    expect(await localPost(jonasPostId)).toBeUndefined();
  });

  it("udløbet session stopper kørslen og lægger indlægget tilbage i køen", async () => {
    const id = await newLocalPost("Efter logud", false);
    const expired = makeDeps(baseUrl, { ...sara, cookie: "better-auth.session_token=ugyldig" });
    await expect(runSyncWith(expired, local, { pull: false, ignoreBackoff: true })).rejects.toBeInstanceOf(AuthError);
    expect((await localPost(id))?.syncStatus).toBe("lokal");
  });
});
