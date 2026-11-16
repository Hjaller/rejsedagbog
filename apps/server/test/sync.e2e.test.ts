import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AppRouter } from "@rejsedagbog/api/routers/index";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  countPending,
  insertPost,
  insertTrip,
  listPosts,
  markPostDeleted,
  postImageUri,
  postVideoUri,
  updatePostPosition,
  updatePostText,
  type LocalPost,
} from "../../native/lib/local-db/repo";
import type { LocalDb } from "../../native/lib/local-db/types";
import {
  AuthError,
  OfflineError,
  runSyncWith,
  type SyncDeps,
} from "../../native/lib/sync/sync-engine";
import { createTestApp, jpegWithGps, signUp, videoWithLocation, type TestContext, type TestUser } from "./helpers";
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
    async uploadMedia({ tripId, mediaId, localUri, kind }) {
      counters.uploads++;
      const form = new FormData();
      form.append("tripId", tripId);
      form.append("mediaId", mediaId);
      form.append("kind", kind);
      const type = kind === "video" ? "video/mp4" : "image/jpeg";
      form.append("file", new Blob([await readFile(localUri)], { type }), `${mediaId}.${kind === "video" ? "mp4" : "jpg"}`);
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

  it("en programfejl under upload vises som fejl og ligner ikke manglende net", async () => {
    const id = await newLocalPost("Programfejl");
    const broken: SyncDeps = {
      ...makeDeps(baseUrl, sara),
      uploadMedia: async () => {
        throw new TypeError("Unsupported FormDataPart implementation");
      },
    };
    const result = await runSyncWith(broken, local, { pull: false, ignoreBackoff: true });
    expect(result).toMatchObject({ offline: false, failed: 1 });
    expect(await localPost(id)).toMatchObject({ syncStatus: "fejl", attempts: 1 });

    await runSyncWith(makeDeps(baseUrl, sara), local, { pull: false, ignoreBackoff: true });
    expect((await localPost(id))?.syncStatus).toBe("synkroniseret");
  });

  it("fetch uden svar tælles som manglende net, ikke som et fejlet forsøg", async () => {
    const id = await newLocalPost("Tunnel");
    const offline: SyncDeps = {
      ...makeDeps(baseUrl, sara),
      uploadMedia: async () => {
        throw new TypeError("Network request failed");
      },
    };
    const result = await runSyncWith(offline, local, { pull: false, ignoreBackoff: true });
    expect(result.offline).toBe(true);
    expect(await localPost(id)).toMatchObject({ syncStatus: "lokal", attempts: 0 });

    await runSyncWith(makeDeps(baseUrl, sara), local, { pull: false, ignoreBackoff: true });
    expect((await localPost(id))?.syncStatus).toBe("synkroniseret");
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

  // ---------------------------------------------------------------------------
  // Redigér og slet egne indlæg (Should)
  // ---------------------------------------------------------------------------

  /** Hele rækken, også når indlægget er markeret som slettet (listPosts skjuler dem). */
  const rawPost = (id: string) =>
    local.getFirstAsync<{ text: string; pendingOp: string | null; deletedAt: string | null }>(
      "SELECT text, pendingOp, deletedAt FROM posts WHERE id = ?",
      id,
    );

  const objectKeysFor = (id: string) => [...t.storage.objects.keys()].filter((k) => k.includes(id));

  /** Kopi af deps, hvor ét tRPC-kald under posts fejler med en serverfejl. */
  function failingPosts(deps: SyncDeps, method: "create" | "update"): SyncDeps {
    return {
      ...deps,
      api: new Proxy(deps.api, {
        get(target, prop) {
          if (prop !== "posts") return Reflect.get(target, prop);
          return new Proxy(target.posts, {
            get(posts, name) {
              if (name !== method) return Reflect.get(posts, name);
              return {
                mutate: async () => {
                  throw new Error("Serveren svarede 500");
                },
              };
            },
          });
        },
      }),
    };
  }

  it("en rettelse offline gemmes lokalt og sendes, når nettet kommer", async () => {
    const id = await newLocalPost("Original", false);
    await runSyncWith(makeDeps(baseUrl, sara), local, { pull: false, ignoreBackoff: true });
    expect((await localPost(id))?.syncStatus).toBe("synkroniseret");
    const pendingBefore = await countPending(local, tripId);

    await updatePostText(local, id, "Rettet i flytilstand");
    expect(await localPost(id)).toMatchObject({ text: "Rettet i flytilstand", pendingOp: "update" });
    expect(await countPending(local, tripId)).toBe(pendingBefore + 1);

    const offline = await runSyncWith(makeDeps(DEAD_URL, sara), local, { pull: true, ignoreBackoff: true });
    expect(offline.offline).toBe(true);
    expect((await t.db.post.findUniqueOrThrow({ where: { id } })).text).toBe("Original");

    const online = await runSyncWith(makeDeps(baseUrl, sara), local, { pull: true, ignoreBackoff: true });
    expect(online.changesPushed).toBe(1);
    expect((await t.db.post.findUniqueOrThrow({ where: { id } })).text).toBe("Rettet i flytilstand");
    expect(await localPost(id)).toMatchObject({ text: "Rettet i flytilstand", pendingOp: null });
    expect(await countPending(local, tripId)).toBe(pendingBefore);
  });

  it("en rettelse, der fejler på serveren, overskrives ikke af hentningen og prøves igen", async () => {
    const id = await newLocalPost("Før", false);
    await runSyncWith(makeDeps(baseUrl, sara), local, { pull: false, ignoreBackoff: true });
    await updatePostText(local, id, "Efter");

    const result = await runSyncWith(failingPosts(makeDeps(baseUrl, sara), "update"), local, {
      pull: true,
      ignoreBackoff: true,
    });
    expect(result.failed).toBe(1);
    // Hentningen bragte serverens "Før" med, men den lokale rettelse vinder.
    expect(await localPost(id)).toMatchObject({ text: "Efter", pendingOp: "update" });

    await runSyncWith(makeDeps(baseUrl, sara), local, { pull: true, ignoreBackoff: true });
    expect((await t.db.post.findUniqueOrThrow({ where: { id } })).text).toBe("Efter");
  });

  it("en rettelse af et indlæg, der ikke er uploadet endnu, kommer med op", async () => {
    const id = await newLocalPost("Kladde", false);
    await updatePostText(local, id, "Færdig tekst");
    await runSyncWith(makeDeps(baseUrl, sara), local, { pull: false, ignoreBackoff: true });
    expect((await t.db.post.findUniqueOrThrow({ where: { id } })).text).toBe("Færdig tekst");
    expect((await localPost(id))?.pendingOp).toBeNull();
  });

  it("et sted sat i hånden offline sendes, når nettet kommer, og serveren finder stednavnet", async () => {
    const id = await newLocalPost("Fra albummet uden GPS", false);
    await runSyncWith(makeDeps(baseUrl, sara), local, { pull: false, ignoreBackoff: true });

    await updatePostPosition(local, id, { lat: 48.8584, lon: 2.2945 });
    expect(await localPost(id)).toMatchObject({ lat: 48.8584, lon: 2.2945, placeName: null, pendingOp: "update" });

    const offline = await runSyncWith(makeDeps(DEAD_URL, sara), local, { pull: true, ignoreBackoff: true });
    expect(offline.offline).toBe(true);
    expect((await t.db.post.findUniqueOrThrow({ where: { id } })).lat).toBeNull();

    // Kun Nominatim og Open-Meteo mockes; kaldene til testserveren går igennem.
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
      const body = url.includes("nominatim") ? { name: "Eiffeltårnet", address: { city: "Paris", country_code: "fr" } } : {};
      return Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
    });
    try {
      const online = await runSyncWith(makeDeps(baseUrl, sara), local, { pull: true, ignoreBackoff: true });
      expect(online.changesPushed).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(await t.db.post.findUniqueOrThrow({ where: { id } })).toMatchObject({
      lat: 48.8584,
      lon: 2.2945,
      placeName: "Eiffeltårnet, Paris",
    });
    expect(await localPost(id)).toMatchObject({ placeName: "Eiffeltårnet, Paris", pendingOp: null });
  });

  it("sletning offline: væk med det samme, og slettet på serveren med billede, når nettet kommer", async () => {
    const id = await newLocalPost("Slet mig");
    await runSyncWith(makeDeps(baseUrl, sara), local, { pull: false, ignoreBackoff: true });
    expect(objectKeysFor(id)).toHaveLength(2); // original + thumbnail
    const file = (await localPost(id))!.localImageUri!;

    await markPostDeleted(local, id);
    expect(await localPost(id)).toBeUndefined(); // skjult i appen med det samme

    await runSyncWith(makeDeps(DEAD_URL, sara), local, { pull: true, ignoreBackoff: true });
    expect(await rawPost(id)).toMatchObject({ pendingOp: "delete" });
    expect((await t.db.post.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();

    const deleted: string[] = [];
    const deps = { ...makeDeps(baseUrl, sara), deleteFile: (uri: string) => void deleted.push(uri) };
    const online = await runSyncWith(deps, local, { pull: true, ignoreBackoff: true });
    expect(online.changesPushed).toBe(1);

    expect((await t.db.post.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
    expect(await t.db.media.count({ where: { id } })).toBe(0);
    expect(objectKeysFor(id)).toHaveLength(0);
    expect(await rawPost(id)).toBeNull();
    expect(deleted).toEqual([file]); // den lokale billedfil ryddes også op
  });

  it("et indlæg, der slettes før upload, sendes aldrig til serveren", async () => {
    const id = await newLocalPost("Fortrudt");
    await markPostDeleted(local, id);
    const counters = { uploads: 0 };
    const result = await runSyncWith(makeDeps(baseUrl, sara, counters), local, { pull: true, ignoreBackoff: true });
    expect(result.failed).toBe(0);
    expect(counters.uploads).toBe(0);
    expect(await t.db.post.count({ where: { id } })).toBe(0);
    expect(await rawPost(id)).toBeNull();
  });

  it("billede uploadet, men indlægget aldrig oprettet: sletning fjerner billedet fra bucket'en", async () => {
    const id = await newLocalPost("Halvvejs");
    await runSyncWith(failingPosts(makeDeps(baseUrl, sara), "create"), local, { pull: false, ignoreBackoff: true });
    expect(await t.db.media.findUnique({ where: { id } })).toMatchObject({ postId: null });
    expect(objectKeysFor(id)).toHaveLength(2);

    await markPostDeleted(local, id);
    await runSyncWith(makeDeps(baseUrl, sara), local, { pull: false, ignoreBackoff: true });
    expect(await t.db.media.count({ where: { id } })).toBe(0);
    expect(objectKeysFor(id)).toHaveLength(0);
    expect(await t.db.post.count({ where: { id } })).toBe(0);
    expect(await rawPost(id)).toBeNull();
  });

  it("en andens indlæg kan ikke slettes: serveren afviser, og indlægget kommer tilbage", async () => {
    const jonasApi = makeDeps(baseUrl, jonas).api;
    const jonasPostId = randomUUID();
    await jonasApi.posts.create.mutate({ id: jonasPostId, tripId, text: "Jonas' billede", takenAt: new Date().toISOString() });
    await runSyncWith(makeDeps(baseUrl, sara), local, { pull: true, ignoreBackoff: true });

    // Appen viser ikke "Slet" på andres indlæg; her tester vi, at serveren og køen alligevel holder.
    await markPostDeleted(local, jonasPostId);
    const result = await runSyncWith(makeDeps(baseUrl, sara), local, { pull: true, ignoreBackoff: true });
    expect(result.failed).toBe(1);
    expect(await localPost(jonasPostId)).toMatchObject({ text: "Jonas' billede", pendingOp: null });
    expect((await t.db.post.findUniqueOrThrow({ where: { id: jonasPostId } })).deletedAt).toBeNull();
  });

  it("video (Could): optaget offline, uploades som video, og en anden i gruppen får den med plakat og længde", async () => {
    const id = randomUUID();
    const localImageUri = path.join(dir, `${id}.mp4`);
    const localThumbUri = path.join(dir, `${id}_poster.jpg`);
    await writeFile(localImageUri, await videoWithLocation());
    await writeFile(localThumbUri, await jpegWithGps(320, 240));
    await insertPost(local, {
      id,
      tripId,
      authorId: sara.id,
      authorName: "Sara",
      text: "Trevi i bevægelse",
      takenAt: new Date().toISOString(),
      lat: null,
      lon: null,
      placeName: null,
      weather: null,
      countryCode: "IT",
      localImageUri,
      mediaKind: "video",
      localThumbUri,
      durationMs: 2000,
    });

    // Offline: venter i køen som alle andre indlæg.
    await runSyncWith(makeDeps(DEAD_URL, sara), local, { pull: false, ignoreBackoff: true });
    expect(await localPost(id)).toMatchObject({ syncStatus: "lokal", mediaKind: "video" });

    const counters = { uploads: 0 };
    await runSyncWith(makeDeps(baseUrl, sara, counters), local, { pull: true, ignoreBackoff: true });
    expect(counters.uploads).toBe(1);
    const mine = (await localPost(id))!;
    expect(mine).toMatchObject({ syncStatus: "synkroniseret", mediaKind: "video", durationMs: 2000 });
    // Egne videoer vises fra telefonens egne filer, også offline.
    expect(postVideoUri(mine)).toBe(localImageUri);
    expect(postImageUri(mine)).toBe(localThumbUri);
    expect(objectKeysFor(id).sort()).toEqual([`trips/${tripId}/${id}.mp4`, `trips/${tripId}/${id}_thumb.jpg`]);
    expect(await t.db.media.findUniqueOrThrow({ where: { id } })).toMatchObject({ kind: "video", postId: id });

    // Jonas' telefon (medlem af rejsen) henter videoen med serverens plakat.
    const jonasLocal = createLocalSqlite();
    await runSyncWith(makeDeps(baseUrl, jonas), jonasLocal, { pull: true, ignoreBackoff: true });
    const theirs = (await listPosts(jonasLocal, tripId)).find((p) => p.id === id)!;
    expect(theirs).toMatchObject({ mediaKind: "video", durationMs: 2000, localImageUri: null });
    expect(postVideoUri(theirs)).toMatch(new RegExp(`${id}\\.mp4\\?`));
    expect(postImageUri(theirs, "thumb")).toMatch(new RegExp(`${id}_thumb\\.jpg\\?`));

    // Sletning fjerner videoen og plakaten i bucket'en og begge lokale filer.
    await markPostDeleted(local, id);
    const deleted: string[] = [];
    await runSyncWith({ ...makeDeps(baseUrl, sara), deleteFile: (u: string) => void deleted.push(u) }, local, {
      pull: false,
      ignoreBackoff: true,
    });
    expect(deleted.sort()).toEqual([localImageUri, localThumbUri].sort());
    expect(objectKeysFor(id)).toHaveLength(0);
  });
});

describe("indlæg fra alle rejser (valget \"Alle rejser\")", () => {
  it("listPosts uden rejse giver alle rejsers indlæg, nyeste først og uden slettede", async () => {
    const db = createLocalSqlite();
    const rome = randomUUID();
    const tokyo = randomUUID();
    await insertTrip(db, { id: rome, name: "Rom", countryCode: "IT", startDate: "2026-05-12", endDate: "2026-05-19" });
    await insertTrip(db, { id: tokyo, name: "Tokyo", countryCode: "JP", startDate: "2026-09-01", endDate: "2026-09-10" });
    const post = (id: string, tripId: string, takenAt: string) =>
      insertPost(db, {
        id,
        tripId,
        authorId: "u1",
        authorName: "Sara",
        text: id,
        takenAt,
        lat: null,
        lon: null,
        placeName: null,
        weather: null,
        countryCode: null,
        localImageUri: null,
      });
    await post("rom-1", rome, "2026-05-13T10:00:00.000Z");
    await post("tokyo-1", tokyo, "2026-09-02T10:00:00.000Z");
    await post("rom-2", rome, "2026-05-15T10:00:00.000Z");
    await post("slettet", tokyo, "2026-09-03T10:00:00.000Z");
    await markPostDeleted(db, "slettet");

    expect((await listPosts(db, null)).map((p) => p.id)).toEqual(["tokyo-1", "rom-2", "rom-1"]);
    expect((await listPosts(db, rome)).map((p) => p.id)).toEqual(["rom-2", "rom-1"]);
  });
});
