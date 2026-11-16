import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestApp, mutate, newTripInput, query, signUp, type TestContext, type TestUser } from "./helpers";

type Post = { id: string; text: string; deletedAt: string | null; updatedAt: string; author: { id: string } };

describe("indlæg i en grupperejse", () => {
  let t: TestContext;
  let sara: TestUser;
  let jonas: TestUser;
  const trip = newTripInput("Gruppetur");

  beforeAll(async () => {
    t = await createTestApp();
    sara = await signUp(t.app, "Sara");
    jonas = await signUp(t.app, "Jonas");
    await mutate(t.app, "trips.create", trip, sara);
    // Invitationskoder kommer i uge 3; indtil da tilføjes medlemmet direkte.
    await t.db.tripMember.create({ data: { tripId: trip.id, userId: jonas.id, role: "member" } });
  });

  afterAll(() => t.close());

  it("posts.create er idempotent ved retry", async () => {
    const input = { id: randomUUID(), tripId: trip.id, text: "Retry", takenAt: "2026-05-14T10:00:00Z" };
    const first = await mutate<Post>(t.app, "posts.create", input, sara);
    const second = await mutate<Post>(t.app, "posts.create", input, sara);
    expect(first.ok && second.ok).toBe(true);
    expect(await t.db.post.count({ where: { id: input.id } })).toBe(1);
  });

  it("et medlem kan læse, men ikke redigere eller slette andres indlæg", async () => {
    const postId = randomUUID();
    await mutate(t.app, "posts.create", { id: postId, tripId: trip.id, text: "Saras", takenAt: "2026-05-14T11:00:00Z" }, sara);

    const read = await query<Post>(t.app, "posts.get", { tripId: trip.id, postId }, jonas);
    expect(read.ok).toBe(true);

    const edit = await mutate(t.app, "posts.update", { tripId: trip.id, postId, text: "Jonas var her" }, jonas);
    expect(!edit.ok && edit.code).toBe("FORBIDDEN");
    const del = await mutate(t.app, "posts.delete", { tripId: trip.id, postId }, jonas);
    expect(!del.ok && del.code).toBe("FORBIDDEN");

    const own = await mutate<Post>(t.app, "posts.update", { tripId: trip.id, postId, text: "Rettet" }, sara);
    expect(own.ok && own.data.text).toBe("Rettet");
  });

  it("et medlem kan ikke ændre eller slette rejsen", async () => {
    const res = await mutate(t.app, "trips.delete", { tripId: trip.id }, jonas);
    expect(!res.ok && res.code).toBe("FORBIDDEN");
  });

  it("slettede indlæg forsvinder fra listen og kommer med som tombstone med since", async () => {
    const postId = randomUUID();
    const created = await mutate<Post>(
      t.app,
      "posts.create",
      { id: postId, tripId: trip.id, text: "Slettes", takenAt: "2026-05-15T09:00:00Z" },
      sara,
    );
    expect(created.ok).toBe(true);
    const since = new Date(Date.now() - 60_000).toISOString();

    await mutate(t.app, "posts.delete", { tripId: trip.id, postId }, sara);

    const list = await query<Post[]>(t.app, "posts.list", { tripId: trip.id }, jonas);
    expect(list.ok && list.data.map((p) => p.id)).not.toContain(postId);

    const changes = await query<Post[]>(t.app, "posts.list", { tripId: trip.id, since }, jonas);
    const tombstone = changes.ok ? changes.data.find((p) => p.id === postId) : undefined;
    expect(tombstone?.deletedAt).toBeTruthy();
    expect(tombstone?.text).toBe("");
  });

  it("sletning fjerner position, sted og vejr fra både database og tombstone", async () => {
    const postId = randomUUID();
    await mutate(t.app, "posts.create", { id: postId, tripId: trip.id, text: "Hemmeligt sted", takenAt: "2026-05-15T10:00:00Z" }, sara);
    const place = {
      lat: 41.9,
      lon: 12.5,
      placeName: "Colosseum, Rom",
      weather: { tempC: 21, code: 0, windKmh: 5 },
      countryCode: "IT",
    };
    // Sat direkte, så testen ikke kalder Nominatim og Open-Meteo.
    await t.db.post.update({ where: { id: postId }, data: place });
    const since = new Date(Date.now() - 60_000).toISOString();

    await mutate(t.app, "posts.delete", { tripId: trip.id, postId }, sara);

    const row = await t.db.post.findUniqueOrThrow({ where: { id: postId } });
    expect(row).toMatchObject({ text: "", lat: null, lon: null, placeName: null, weather: null, countryCode: null });
    expect(row.deletedAt).toBeTruthy();

    // Rækker slettet før rettelsen kan stadig have data: de må heller ikke sendes ud.
    await t.db.post.update({ where: { id: postId }, data: place });
    const changes = await query<Record<string, unknown>[]>(t.app, "posts.list", { tripId: trip.id, since }, jonas);
    const tombstone = changes.ok ? changes.data.find((p) => p.id === postId) : undefined;
    expect(tombstone).toMatchObject({ lat: null, lon: null, placeName: null, weather: null, countryCode: null, media: [] });
  });

  it("afviser for lang tekst med en dansk fejlbesked", async () => {
    const res = await mutate(
      t.app,
      "posts.create",
      { id: randomUUID(), tripId: trip.id, text: "x".repeat(501), takenAt: "2026-05-14T10:00:00Z" },
      sara,
    );
    expect(!res.ok && res.code).toBe("BAD_REQUEST");
    if (!res.ok) expect(res.message).toBe("Højst 500 tegn");
  });

  describe("sted sat i hånden (posts.update med position)", () => {
    let fetchedUrls: string[] = [];

    beforeEach(() => {
      fetchedUrls = [];
      // Nominatim og Open-Meteo mockes; vejret udelades, så kun stednavnet tjekkes.
      vi.stubGlobal("fetch", (url: string) => {
        fetchedUrls.push(url);
        const body = url.includes("nominatim")
          ? { name: "Colosseum", address: { city: "Rom", country_code: "it" } }
          : {};
        return Promise.resolve({ ok: true, json: async () => body });
      });
    });

    afterEach(() => vi.unstubAllGlobals());

    it("forfatteren kan sætte en position, og sted findes på ny", async () => {
      const postId = randomUUID();
      await mutate(t.app, "posts.create", { id: postId, tripId: trip.id, text: "Fra albummet", takenAt: "2026-05-16T10:00:00Z" }, sara);

      const res = await mutate<Record<string, unknown>>(
        t.app,
        "posts.update",
        { tripId: trip.id, postId, text: "Fra albummet", lat: 41.8902, lon: 12.4922 },
        sara,
      );
      expect(res.ok && res.data).toMatchObject({ lat: 41.8902, lon: 12.4922, placeName: "Colosseum, Rom", countryCode: "IT" });
      expect(fetchedUrls.some((u) => u.includes("nominatim"))).toBe(true);

      // Samme position igen (fx kun teksten rettet): ingen ny berigelse.
      fetchedUrls = [];
      const textOnly = await mutate<Record<string, unknown>>(
        t.app,
        "posts.update",
        { tripId: trip.id, postId, text: "Rettet tekst", lat: 41.8902, lon: 12.4922 },
        sara,
      );
      expect(textOnly.ok && textOnly.data).toMatchObject({ text: "Rettet tekst", placeName: "Colosseum, Rom" });
      expect(fetchedUrls).toEqual([]);
    });

    it("et andet medlem kan ikke flytte indlægget", async () => {
      const postId = randomUUID();
      await mutate(t.app, "posts.create", { id: postId, tripId: trip.id, text: "", takenAt: "2026-05-16T11:00:00Z" }, sara);
      const res = await mutate(t.app, "posts.update", { tripId: trip.id, postId, text: "", lat: 41.9, lon: 12.5 }, jonas);
      expect(!res.ok && res.code).toBe("FORBIDDEN");
      const row = await t.db.post.findUniqueOrThrow({ where: { id: postId } });
      expect(row.lat).toBeNull();
    });

    it("afviser bredde- uden længdegrad", async () => {
      const postId = randomUUID();
      await mutate(t.app, "posts.create", { id: postId, tripId: trip.id, text: "", takenAt: "2026-05-16T12:00:00Z" }, sara);
      const res = await mutate(t.app, "posts.update", { tripId: trip.id, postId, text: "", lat: 41.9 }, sara);
      expect(!res.ok && res.code).toBe("BAD_REQUEST");
    });

    it("stedsøgning foretrækker rejsens land og søger overalt, hvis intet findes dér", async () => {
      vi.stubGlobal("fetch", (url: string) => {
        fetchedUrls.push(url);
        const hits = url.includes("countrycodes=")
          ? []
          : [{ name: "Tivoli", lat: "55.6737", lon: "12.5681", address: { city: "København", country: "Danmark" } }];
        return Promise.resolve({ ok: true, json: async () => hits });
      });
      const res = await mutate<unknown[]>(t.app, "enrich.searchPlaces", { query: "Tivoli", countryCode: "IT" }, sara);
      expect(res.ok && res.data).toEqual([{ name: "Tivoli", detail: "København, Danmark", lat: 55.6737, lon: 12.5681 }]);
      expect(fetchedUrls).toHaveLength(2);
      expect(fetchedUrls[0]).toContain("countrycodes=it");
    });
  });
});
