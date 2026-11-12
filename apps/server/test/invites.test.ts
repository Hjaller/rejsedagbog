import { randomUUID } from "node:crypto";

import { INVITE_CODE_PATTERN } from "@rejsedagbog/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, mutate, newTripInput, query, signUp, type TestContext, type TestUser } from "./helpers";

type TripDto = { id: string; role: string; memberCount: number; inviteCode: string | null };

/**
 * Grupperejser med invitationskode (Should). Koden giver kun adgang til den ene
 * rejse, kun ejeren kan se og styre den, og den kan ikke gættes ved at prøve løs.
 */
describe("invitationskoder", () => {
  let t: TestContext;
  let sara: TestUser;
  let jonas: TestUser;
  let mia: TestUser;
  const trip = newTripInput("Grupperejse");
  const otherTrip = newTripInput("Saras anden rejse");
  const postId = randomUUID();
  let code: string;

  beforeAll(async () => {
    t = await createTestApp();
    sara = await signUp(t.app, "Sara");
    jonas = await signUp(t.app, "Jonas");
    mia = await signUp(t.app, "Mia");
    expect((await mutate(t.app, "trips.create", trip, sara)).ok).toBe(true);
    expect((await mutate(t.app, "trips.create", otherTrip, sara)).ok).toBe(true);
    const post = await mutate(
      t.app,
      "posts.create",
      { id: postId, tripId: trip.id, text: "Ankommet", takenAt: "2026-05-12T10:00:00Z" },
      sara,
    );
    expect(post.ok).toBe(true);
  });

  afterAll(() => t.close());

  it("ejeren får en kode på 6 tegn, og samme kode igen ved næste kald", async () => {
    const first = await mutate<{ code: string }>(t.app, "invites.createCode", { tripId: trip.id }, sara);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    code = first.data.code;
    expect(code).toMatch(INVITE_CODE_PATTERN);

    const again = await mutate<{ code: string }>(t.app, "invites.createCode", { tripId: trip.id }, sara);
    expect(again.ok && again.data.code).toBe(code);

    const list = await query<TripDto[]>(t.app, "trips.list", undefined, sara);
    expect(list.ok && list.data.find((x) => x.id === trip.id)?.inviteCode).toBe(code);
  });

  it("en fremmed kan ikke lave eller fjerne en kode", async () => {
    for (const path of ["invites.createCode", "invites.revokeCode"]) {
      const res = await mutate(t.app, path, { tripId: trip.id }, jonas);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("NOT_FOUND");
    }
  });

  it("med koden bliver man medlem og kan se rejsens indlæg, men ikke koden", async () => {
    // Små bogstaver og mellemrum accepteres, fordi koden typisk skrives af.
    const joined = await mutate<TripDto>(t.app, "invites.join", { code: ` ${code.toLowerCase()} ` }, jonas);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.data).toMatchObject({ id: trip.id, role: "member", memberCount: 2, inviteCode: null });

    const posts = await query<{ id: string }[]>(t.app, "posts.list", { tripId: trip.id }, jonas);
    expect(posts.ok && posts.data.map((p) => p.id)).toEqual([postId]);

    const list = await query<TripDto[]>(t.app, "trips.list", undefined, jonas);
    expect(list.ok && list.data.map((x) => x.inviteCode)).toEqual([null]);
  });

  it("koden giver kun adgang til den ene rejse", async () => {
    const res = await query(t.app, "trips.get", { tripId: otherTrip.id }, jonas);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("at tilslutte sig igen giver ikke et ekstra medlemskab", async () => {
    const again = await mutate<TripDto>(t.app, "invites.join", { code }, jonas);
    expect(again.ok && again.data.memberCount).toBe(2);
    expect(await t.db.tripMember.count({ where: { tripId: trip.id } })).toBe(2);
  });

  it("ejeren beholder sin rolle, hvis hun bruger sin egen kode", async () => {
    const res = await mutate<TripDto>(t.app, "invites.join", { code }, sara);
    expect(res.ok && res.data.role).toBe("owner");
  });

  it("et medlem kan ikke styre koden", async () => {
    const res = await mutate(t.app, "invites.createCode", { tripId: trip.id }, jonas);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });

  it("et medlem kan ikke redigere eller slette ejerens indlæg", async () => {
    for (const [path, input] of [
      ["posts.update", { tripId: trip.id, postId, text: "Hacket" }],
      ["posts.delete", { tripId: trip.id, postId }],
    ] as const) {
      const res = await mutate(t.app, path, input, jonas);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("FORBIDDEN");
    }
  });

  it("ugyldigt format giver BAD_REQUEST, og en ukendt kode giver NOT_FOUND", async () => {
    const bad = await mutate(t.app, "invites.join", { code: "ABC" }, mia);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("BAD_REQUEST");

    const unknown = await mutate(t.app, "invites.join", { code: code === "ZZZZZZ" ? "YYYYYY" : "ZZZZZZ" }, mia);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.code).toBe("NOT_FOUND");
  });

  it("når koden er fjernet, kan ingen nye tilslutte sig, men medlemmer bliver", async () => {
    expect((await mutate(t.app, "invites.revokeCode", { tripId: trip.id }, sara)).ok).toBe(true);

    const res = await mutate(t.app, "invites.join", { code }, mia);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");

    expect((await query(t.app, "trips.get", { tripId: trip.id }, jonas)).ok).toBe(true);

    // En ny kode er en anden end den gamle.
    const fresh = await mutate<{ code: string }>(t.app, "invites.createCode", { tripId: trip.id }, sara);
    expect(fresh.ok && fresh.data.code).not.toBe(code);
  });

  it("efter 10 forsøg på 10 minutter afvises flere, også med en rigtig kode", async () => {
    const guesser = await signUp(t.app, "Guesser");
    for (let i = 0; i < 9; i++) {
      const res = await mutate(t.app, "invites.join", { code: "QQQQQQ" }, guesser);
      expect(res.ok || res.code).toBe("NOT_FOUND");
    }
    // Det 10. forsøg går stadig igennem til opslaget.
    const tenth = await mutate(t.app, "invites.join", { code: "QQQQQQ" }, guesser);
    expect(tenth.ok || tenth.code).toBe("NOT_FOUND");

    const fresh = await mutate<{ code: string }>(t.app, "invites.createCode", { tripId: trip.id }, sara);
    if (!fresh.ok) throw new Error("Ingen kode");
    const blocked = await mutate(t.app, "invites.join", { code: fresh.data.code }, guesser);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("TOO_MANY_REQUESTS");
      expect(blocked.status).toBe(429);
    }
  });

  it("uden login: UNAUTHORIZED", async () => {
    const res = await mutate(t.app, "invites.join", { code: "ABCDEF" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });
});

/**
 * Konti er billige (5 pr. minut pr. IP), så grænsen pr. bruger alene kan omgås ved at
 * oprette mange konti. Forkerte koder tælles derfor også pr. IP.
 */
describe("invitationskoder: grænse pr. IP", () => {
  let t: TestContext;
  let owner: TestUser;
  let users: TestUser[];
  const trip = newTripInput("IP-grænse");

  const joinFrom = async (user: TestUser, code: string, remoteAddress: string) => {
    const res = await t.app.inject({
      method: "POST",
      url: "/trpc/invites.join",
      remoteAddress,
      headers: { origin: "http://localhost:3001", "content-type": "application/json", cookie: user.cookie },
      payload: JSON.stringify({ code }),
    });
    return { status: res.statusCode, code: res.json().error?.data?.code as string | undefined };
  };

  beforeAll(async () => {
    t = await createTestApp();
    const ip = "10.0.0.99";
    owner = await signUp(t.app, "Owner", ip);
    users = [await signUp(t.app, "Anna", ip), await signUp(t.app, "Bo", ip), await signUp(t.app, "Carl", ip)];
    expect((await mutate(t.app, "trips.create", trip, owner)).ok).toBe(true);
  });

  afterAll(() => t.close());

  it("20 forkerte koder fra samme IP spærrer IP'en, også for nye konti med en rigtig kode", async () => {
    const created = await mutate<{ code: string }>(t.app, "invites.createCode", { tripId: trip.id }, owner);
    if (!created.ok) throw new Error("Ingen kode");
    const wrong = created.data.code === "QQQQQQ" ? "WWWWWW" : "QQQQQQ";

    // To konti med 10 forsøg hver: hver for sig under grænsen pr. bruger.
    for (const user of users.slice(0, 2)) {
      for (let i = 0; i < 10; i++) expect((await joinFrom(user, wrong, "10.0.0.7")).code).toBe("NOT_FOUND");
    }

    const blocked = await joinFrom(users[2]!, created.data.code, "10.0.0.7");
    expect(blocked).toMatchObject({ status: 429, code: "TOO_MANY_REQUESTS" });

    // Samme konto fra en anden IP kommer ind.
    const other = await joinFrom(users[2]!, created.data.code, "10.0.0.8");
    expect(other).toMatchObject({ status: 200, code: undefined });
  });
});
