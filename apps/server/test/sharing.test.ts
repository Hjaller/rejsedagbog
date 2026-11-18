import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { INVITE_CODE_PATTERN } from "@rejsedagbog/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate, MIGRATIONS } from "../../native/lib/local-db/migrations";
import { insertTrip, listTrips } from "../../native/lib/local-db/repo";
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
import { createLocalSqlite } from "./local-sqlite";

type TripDto = {
  id: string;
  role: string;
  memberCount: number;
  inviteCode: string | null;
  viewCode: string | null;
  countryCodes: string[];
  countryCode: string;
};

/**
 * Deling til visning: med koden til deling kan man se rejsen, men ikke lægge noget op.
 * Spærringen ligger på serveren (indlæg og upload), ikke kun i appen.
 */
describe("deling til visning", () => {
  let t: TestContext;
  let sara: TestUser; // ejer
  let jonas: TestUser; // får rejsen delt
  let mia: TestUser; // medrejsende
  let fremmed: TestUser;
  const trip = newTripInput("Delt rejse");
  const otherTrip = newTripInput("Saras anden rejse");
  const postId = randomUUID();
  let viewCode: string;
  let inviteCode: string;

  const photo = async () => ({ data: await jpegWithGps(), type: "image/jpeg" });

  beforeAll(async () => {
    t = await createTestApp();
    sara = await signUp(t.app, "Sara");
    jonas = await signUp(t.app, "Jonas");
    mia = await signUp(t.app, "Mia");
    fremmed = await signUp(t.app, "Fremmed");
    expect((await mutate(t.app, "trips.create", trip, sara)).ok).toBe(true);
    expect((await mutate(t.app, "trips.create", otherTrip, sara)).ok).toBe(true);
    expect((await upload(t.app, sara, { tripId: trip.id, mediaId: postId }, await photo())).statusCode).toBe(201);
    const post = await mutate(
      t.app,
      "posts.create",
      { id: postId, tripId: trip.id, text: "Ankommet", takenAt: "2026-05-12T10:00:00Z", mediaId: postId },
      sara,
    );
    expect(post.ok).toBe(true);
  });

  afterAll(() => t.close());

  it("ejeren får en kode til deling, som er en anden end invitationskoden", async () => {
    const view = await mutate<{ code: string }>(t.app, "invites.createCode", { tripId: trip.id, access: "viewer" }, sara);
    // Uden `access` (ældre app-versioner) er det invitationskoden.
    const invite = await mutate<{ code: string }>(t.app, "invites.createCode", { tripId: trip.id }, sara);
    if (!view.ok || !invite.ok) throw new Error("Ingen kode");
    viewCode = view.data.code;
    inviteCode = invite.data.code;
    expect(viewCode).toMatch(INVITE_CODE_PATTERN);
    expect(viewCode).not.toBe(inviteCode);

    const again = await mutate<{ code: string }>(t.app, "invites.createCode", { tripId: trip.id, access: "viewer" }, sara);
    expect(again.ok && again.data.code).toBe(viewCode);

    const list = await query<TripDto[]>(t.app, "trips.list", undefined, sara);
    expect(list.ok && list.data.find((x) => x.id === trip.id)).toMatchObject({ inviteCode, viewCode });
  });

  it("med koden til deling får man rollen viewer og kan se indlæg, billeder og gruppen, men ikke koderne", async () => {
    const joined = await mutate<TripDto>(t.app, "invites.join", { code: viewCode }, jonas);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.data).toMatchObject({ id: trip.id, role: "viewer", memberCount: 2, inviteCode: null, viewCode: null });

    const posts = await query<{ id: string; media: { url: string }[] }[]>(t.app, "posts.list", { tripId: trip.id }, jonas);
    expect(posts.ok && posts.data.map((p) => p.id)).toEqual([postId]);
    if (posts.ok) expect(posts.data[0]?.media[0]?.url).toMatch(/^memory:\/\/trips\//);

    const members = await query<{ name: string; role: string }[]>(t.app, "trips.members", { tripId: trip.id }, jonas);
    expect(members.ok && members.data.map((m) => [m.name, m.role])).toEqual([
      ["Sara", "owner"],
      ["Jonas", "viewer"],
    ]);

    const list = await query<TripDto[]>(t.app, "trips.list", undefined, jonas);
    expect(list.ok && list.data).toMatchObject([{ id: trip.id, role: "viewer", inviteCode: null, viewCode: null }]);
  });

  it("en viewer kan ikke oprette indlæg", async () => {
    const res = await mutate(
      t.app,
      "posts.create",
      { id: randomUUID(), tripId: trip.id, text: "Må jeg?", takenAt: "2026-05-13T10:00:00Z" },
      jonas,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
    expect(await t.db.post.count({ where: { tripId: trip.id } })).toBe(1);
  });

  it("en viewer kan ikke uploade billeder, og intet lægges i lageret", async () => {
    const before = t.storage.objects.size;
    const mediaId = randomUUID();
    const res = await upload(t.app, jonas, { tripId: trip.id, mediaId }, await photo(), null);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(t.storage.objects.size).toBe(before);
    expect(await t.db.media.count({ where: { id: mediaId } })).toBe(0);
  });

  it("en viewer kan ikke redigere eller slette andres indlæg eller styre koderne", async () => {
    for (const [path, input] of [
      ["posts.update", { tripId: trip.id, postId, text: "Hacket" }],
      ["posts.delete", { tripId: trip.id, postId }],
      ["invites.createCode", { tripId: trip.id, access: "viewer" }],
      ["invites.createCode", { tripId: trip.id, access: "member" }],
      ["invites.revokeCode", { tripId: trip.id, access: "viewer" }],
      ["trips.update", { tripId: trip.id, name: "Mit nu", countryCodes: ["DK"], startDate: "2026-05-12", endDate: "2026-05-19" }],
      ["trips.delete", { tripId: trip.id }],
    ] as const) {
      const res = await mutate(t.app, path, input, jonas);
      expect(res.ok, path).toBe(false);
      if (!res.ok) expect(res.code, path).toBe("FORBIDDEN");
    }
    const post = await t.db.post.findUniqueOrThrow({ where: { id: postId } });
    expect(post).toMatchObject({ text: "Ankommet", deletedAt: null });
  });

  it("koden til deling giver kun adgang til den ene rejse", async () => {
    const res = await query(t.app, "posts.list", { tripId: otherTrip.id }, jonas);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("ingen mister adgang ved at bruge koden til deling", async () => {
    expect((await mutate(t.app, "invites.join", { code: inviteCode }, mia)).ok).toBe(true);
    for (const [user, role] of [
      [sara, "owner"],
      [mia, "member"],
      [jonas, "viewer"],
    ] as const) {
      const res = await mutate<TripDto>(t.app, "invites.join", { code: viewCode }, user);
      expect(res.ok && res.data.role, user.name).toBe(role);
    }
    expect(await t.db.tripMember.count({ where: { tripId: trip.id } })).toBe(3);

    // Mia er stadig medlem og kan lægge op.
    const post = await mutate(
      t.app,
      "posts.create",
      { id: randomUUID(), tripId: trip.id, text: "Mias indlæg", takenAt: "2026-05-13T12:00:00Z" },
      mia,
    );
    expect(post.ok).toBe(true);
  });

  it("når delingen stoppes, kan ingen nye bruge koden, men dem med adgang beholder den", async () => {
    expect((await mutate(t.app, "invites.revokeCode", { tripId: trip.id, access: "viewer" }, sara)).ok).toBe(true);

    const res = await mutate(t.app, "invites.join", { code: viewCode }, fremmed);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");

    expect((await query(t.app, "posts.list", { tripId: trip.id }, jonas)).ok).toBe(true);

    // Invitationskoden er ikke rørt.
    const list = await query<TripDto[]>(t.app, "trips.list", undefined, sara);
    expect(list.ok && list.data.find((x) => x.id === trip.id)).toMatchObject({ inviteCode, viewCode: null });
  });

  it("med invitationskoden bliver en viewer medlem og kan lægge op", async () => {
    const joined = await mutate<TripDto>(t.app, "invites.join", { code: inviteCode }, jonas);
    expect(joined.ok && joined.data).toMatchObject({ role: "member", memberCount: 3 });

    const mediaId = randomUUID();
    expect((await upload(t.app, jonas, { tripId: trip.id, mediaId }, await photo(), null)).statusCode).toBe(201);
    const post = await mutate(
      t.app,
      "posts.create",
      { id: mediaId, tripId: trip.id, text: "Nu er jeg med", takenAt: "2026-05-14T10:00:00Z", mediaId },
      jonas,
    );
    expect(post.ok).toBe(true);
  });

  it("en invitationskode og en kode til deling kan aldrig være den samme", async () => {
    // De to kolonner er kun unikke hver for sig i databasen, så serveren skal selv afvise sammenfald.
    const codes = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const input = newTripInput(`Rejse ${i}`);
      expect((await mutate(t.app, "trips.create", input, sara)).ok).toBe(true);
      const [a, b] = await Promise.all([
        mutate<{ code: string }>(t.app, "invites.createCode", { tripId: input.id, access: "member" }, sara),
        mutate<{ code: string }>(t.app, "invites.createCode", { tripId: input.id, access: "viewer" }, sara),
      ]);
      if (!a.ok || !b.ok) throw new Error("Ingen kode");
      codes.add(a.data.code).add(b.data.code);
    }
    expect(codes.size).toBe(12);
  });
});

/** En rundrejse kan gå gennem flere lande. */
describe("rejser med flere lande", () => {
  let t: TestContext;
  let sara: TestUser;
  const base = { name: "Interrail", startDate: "2026-07-01", endDate: "2026-07-21" };

  beforeAll(async () => {
    t = await createTestApp();
    sara = await signUp(t.app, "Sara");
  });

  afterAll(() => t.close());

  it("landene gemmes i rækkefølge uden dubletter", async () => {
    const id = randomUUID();
    const res = await mutate<TripDto>(t.app, "trips.create", { id, ...base, countryCodes: ["IT", "FR", "IT", "ES"] }, sara);
    expect(res.ok && res.data).toMatchObject({ countryCodes: ["IT", "FR", "ES"], countryCode: "IT" });

    const got = await query<TripDto>(t.app, "trips.get", { tripId: id }, sara);
    expect(got.ok && got.data.countryCodes).toEqual(["IT", "FR", "ES"]);
  });

  it("ældre app-versioner kan stadig sende ét land", async () => {
    const res = await mutate<TripDto>(t.app, "trips.create", { id: randomUUID(), ...base, countryCode: "JP" }, sara);
    expect(res.ok && res.data).toMatchObject({ countryCodes: ["JP"], countryCode: "JP" });
  });

  it("uden land, med ukendt land eller med for mange lande: BAD_REQUEST", async () => {
    const tooMany = ["DK", "SE", "NO", "FI", "IS", "DE", "FR", "ES", "PT", "IT", "AT", "CH", "BE", "NL", "LU", "PL", "CZ", "SK", "HU", "SI", "HR"];
    for (const countries of [{}, { countryCodes: [] }, { countryCodes: ["XX"] }, { countryCodes: ["IT", "it"] }, { countryCodes: tooMany }]) {
      const res = await mutate(t.app, "trips.create", { id: randomUUID(), ...base, ...countries }, sara);
      expect(res.ok, JSON.stringify(countries)).toBe(false);
      if (!res.ok) expect(res.code).toBe("BAD_REQUEST");
    }
  });

  it("ejeren kan rette landene", async () => {
    const id = randomUUID();
    expect((await mutate(t.app, "trips.create", { id, ...base, countryCodes: ["IT"] }, sara)).ok).toBe(true);
    const res = await mutate<TripDto>(t.app, "trips.update", { tripId: id, ...base, countryCodes: ["IT", "AT", "DE"] }, sara);
    expect(res.ok && res.data.countryCodes).toEqual(["IT", "AT", "DE"]);
  });

  it("et indlæg uden position får kun rejsens land, når rejsen har ét land", async () => {
    const single = randomUUID();
    const round = randomUUID();
    expect((await mutate(t.app, "trips.create", { id: single, ...base, countryCodes: ["IT"] }, sara)).ok).toBe(true);
    expect((await mutate(t.app, "trips.create", { id: round, ...base, countryCodes: ["IT", "FR"] }, sara)).ok).toBe(true);

    const post = (tripId: string) =>
      mutate<{ countryCode: string | null }>(
        t.app,
        "posts.create",
        { id: randomUUID(), tripId, text: "Uden GPS", takenAt: "2026-07-02T10:00:00Z" },
        sara,
      );
    const a = await post(single);
    const b = await post(round);
    expect(a.ok && a.data.countryCode).toBe("IT");
    expect(b.ok && b.data.countryCode).toBeNull();
  });
});

describe("appens lokale database: flere lande", () => {
  it("en rejse med flere lande kan gemmes og læses igen", async () => {
    const db = createLocalSqlite();
    const id = randomUUID();
    await insertTrip(db, { id, name: "Interrail", countryCodes: ["IT", "FR", "ES"], startDate: "2026-07-01", endDate: "2026-07-21" });
    const [trip] = await listTrips(db);
    expect(trip).toMatchObject({ id, countryCodes: ["IT", "FR", "ES"], role: "owner", viewCode: null });
  });

  it("migrationen bevarer landet på rejser fra en ældre app-version", () => {
    const raw = new DatabaseSync(":memory:");
    // Databasen, som den så ud før v4 (ét land pr. rejse).
    for (const sql of MIGRATIONS.slice(0, 3)) raw.exec(sql);
    raw.exec("PRAGMA user_version = 3");
    raw.exec(
      `INSERT INTO trips (id, name, countryCode, startDate, endDate, createdAt, updatedAt)
       VALUES ('t1', 'Rom', 'IT', '2026-05-12', '2026-05-19', '2026-05-01', '2026-05-01')`,
    );

    migrate({
      execSync: (sql) => raw.exec(sql),
      getFirstSync: <T>(sql: string) => (raw.prepare(sql).get() as T | undefined) ?? null,
      withTransactionSync(fn) {
        raw.exec("BEGIN");
        fn();
        raw.exec("COMMIT");
      },
    });

    expect(raw.prepare("SELECT countryCodes, viewCode, role FROM trips WHERE id = 't1'").get()).toEqual({
      countryCodes: "IT",
      viewCode: null,
      role: "owner",
    });
  });
});
