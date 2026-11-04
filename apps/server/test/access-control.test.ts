import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestApp,
  jpegWithGps,
  mutate,
  newTripInput,
  query,
  signUp,
  upload,
  type TestContext,
  type TestUser,
} from "./helpers";

/**
 * Risikoanalysen: "Et API-endpoint mangler adgangstjek, så private billeder lækker"
 * → test med to brugere, der ikke må kunne se hinandens rejser eller billeder.
 */
describe("adgangskontrol mellem to brugere", () => {
  let t: TestContext;
  let sara: TestUser;
  let jonas: TestUser;
  const trip = newTripInput("Saras rejse");
  const postId = randomUUID();
  const mediaId = randomUUID();

  beforeAll(async () => {
    t = await createTestApp();
    sara = await signUp(t.app, "Sara");
    jonas = await signUp(t.app, "Jonas");

    expect((await mutate(t.app, "trips.create", trip, sara)).ok).toBe(true);
    const up = await upload(t.app, sara, { tripId: trip.id, mediaId }, { data: await jpegWithGps(), type: "image/jpeg" });
    expect(up.statusCode).toBe(201);
    const post = await mutate(
      t.app,
      "posts.create",
      { id: postId, tripId: trip.id, text: "Første dag", takenAt: "2026-05-14T12:32:00Z", mediaId },
      sara,
    );
    expect(post.ok).toBe(true);
  });

  afterAll(() => t.close());

  it("ejeren kan se sin rejse og sit indlæg med signeret billed-URL", async () => {
    const list = await query<{ id: string }[]>(t.app, "trips.list", undefined, sara);
    expect(list.ok && list.data.map((x) => x.id)).toContain(trip.id);

    const post = await query<{ media: { url: string }[] }>(t.app, "posts.get", { tripId: trip.id, postId }, sara);
    expect(post.ok).toBe(true);
    if (post.ok) expect(post.data.media[0]?.url).toMatch(/^memory:\/\/trips\//);
  });

  it("en anden bruger ser ikke rejsen i sin liste", async () => {
    const list = await query<{ id: string }[]>(t.app, "trips.list", undefined, jonas);
    expect(list.ok && list.data.map((x) => x.id)).not.toContain(trip.id);
  });

  it.each([
    ["trips.get", "query", { tripId: trip.id }],
    ["posts.list", "query", { tripId: trip.id }],
    ["posts.get", "query", { tripId: trip.id, postId }],
    ["trips.update", "mutation", { ...trip, id: undefined, tripId: trip.id, name: "Hacket" }],
    ["trips.delete", "mutation", { tripId: trip.id }],
    ["posts.update", "mutation", { tripId: trip.id, postId, text: "Hacket" }],
    ["posts.delete", "mutation", { tripId: trip.id, postId }],
    [
      "posts.create",
      "mutation",
      { id: randomUUID(), tripId: trip.id, text: "Ind ad bagdøren", takenAt: "2026-05-14T12:00:00Z" },
    ],
  ] as const)("%s giver NOT_FOUND for en ikke-medlem", async (path, kind, input) => {
    const res =
      kind === "query" ? await query(t.app, path, input, jonas) : await mutate(t.app, path, input, jonas);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("ikke-medlem kan ikke uploade til rejsen", async () => {
    const res = await upload(
      t.app,
      jonas,
      { tripId: trip.id, mediaId: randomUUID() },
      { data: await jpegWithGps(), type: "image/jpeg" },
    );
    expect(res.statusCode).toBe(404);
  });

  it("ikke-medlem kan ikke genbruge et andet billed-id", async () => {
    const own = newTripInput("Jonas' rejse");
    await mutate(t.app, "trips.create", own, jonas);
    const res = await upload(t.app, jonas, { tripId: own.id, mediaId }, { data: await jpegWithGps(), type: "image/jpeg" });
    expect(res.statusCode).toBe(409);

    const post = await mutate(
      t.app,
      "posts.create",
      { id: randomUUID(), tripId: own.id, text: "Stjålet billede", takenAt: "2026-05-14T12:00:00Z", mediaId },
      jonas,
    );
    expect(post.ok).toBe(false);
    if (!post.ok) expect(post.code).toBe("BAD_REQUEST");
  });

  it("uden login: UNAUTHORIZED på API og 401 på upload", async () => {
    const res = await query(t.app, "trips.list", undefined);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");

    const up = await upload(t.app, undefined, { tripId: trip.id, mediaId: randomUUID() });
    expect(up.statusCode).toBe(401);
  });
});
