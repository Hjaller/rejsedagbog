import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestApp,
  jpegWithGps,
  mutate,
  newTripInput,
  signUp,
  upload,
  type TestContext,
  type TestUser,
} from "./helpers";

describe("POST /api/uploads", () => {
  let t: TestContext;
  let sara: TestUser;
  const trip = newTripInput();

  beforeAll(async () => {
    t = await createTestApp();
    sara = await signUp(t.app, "Sara");
    await mutate(t.app, "trips.create", trip, sara);
  });

  afterAll(() => t.close());

  it("gemmer billede og thumbnail uden EXIF/GPS (sikkerhedsrisiko 3)", async () => {
    const input = await jpegWithGps(3000, 2000);
    const inputMeta = await sharp(input).metadata();
    expect(inputMeta.exif).toBeDefined(); // testbilledet har faktisk EXIF

    const mediaId = randomUUID();
    const res = await upload(t.app, sara, { tripId: trip.id, mediaId }, { data: input, type: "image/jpeg" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ mediaId, width: 2048 });

    const full = t.storage.objects.get(`trips/${trip.id}/${mediaId}.jpg`);
    const thumb = t.storage.objects.get(`trips/${trip.id}/${mediaId}_thumb.jpg`);
    expect(full && thumb).toBeTruthy();
    const fullMeta = await sharp(Buffer.from(full!)).metadata();
    expect(fullMeta.exif).toBeUndefined();
    expect(fullMeta.format).toBe("jpeg");
    expect(Math.max(fullMeta.width!, fullMeta.height!)).toBe(2048);
    const thumbMeta = await sharp(Buffer.from(thumb!)).metadata();
    expect([thumbMeta.width, thumbMeta.height]).toEqual([480, 480]);
  });

  it("er idempotent: samme mediaId giver samme svar og ingen ny række", async () => {
    const mediaId = randomUUID();
    const file = { data: await jpegWithGps(), type: "image/jpeg" };
    const first = await upload(t.app, sara, { tripId: trip.id, mediaId }, file);
    const second = await upload(t.app, sara, { tripId: trip.id, mediaId }, file);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().mediaId).toBe(mediaId);
    expect(await t.db.media.count({ where: { id: mediaId } })).toBe(1);
  });

  it("afviser filer, der ikke er billeder – også når klienten påstår det", async () => {
    const res = await upload(
      t.app,
      sara,
      { tripId: trip.id, mediaId: randomUUID() },
      { data: Buffer.from("<script>alert(1)</script>"), type: "image/jpeg" },
    );
    expect(res.statusCode).toBe(415);
  });

  it("afviser ikke-tilladte filtyper", async () => {
    const res = await upload(
      t.app,
      sara,
      { tripId: trip.id, mediaId: randomUUID() },
      { data: Buffer.from("hej"), type: "text/plain" },
    );
    expect(res.statusCode).toBe(415);
  });

  it("afviser for store filer", async () => {
    const res = await upload(
      t.app,
      sara,
      { tripId: trip.id, mediaId: randomUUID() },
      { data: Buffer.alloc(16 * 1024 * 1024, 1), type: "image/jpeg" },
    );
    expect(res.statusCode).toBe(413);
  });

  it("CSRF: afviser upload fra et fremmed site, selv med gyldig cookie", async () => {
    const mediaId = randomUUID();
    const file = { data: await jpegWithGps(), type: "image/jpeg" };
    const res = await upload(t.app, sara, { tripId: trip.id, mediaId }, file, "https://ond-side.example");
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN_ORIGIN");
    expect(await t.db.media.count({ where: { id: mediaId } })).toBe(0);
    expect(t.storage.objects.has(`trips/${trip.id}/${mediaId}.jpg`)).toBe(false);
  });

  it("mobilappen uden Origin-header kan stadig uploade", async () => {
    const file = { data: await jpegWithGps(), type: "image/jpeg" };
    const res = await upload(t.app, sara, { tripId: trip.id, mediaId: randomUUID() }, file, null);
    expect(res.statusCode).toBe(201);
  });

  it("afviser ugyldige felter", async () => {
    const res = await upload(t.app, sara, { tripId: "ikke-et-id", mediaId: randomUUID() });
    expect(res.statusCode).toBe(400);
  });
});
