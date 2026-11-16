import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseRange } from "../src/routes/media";
import { parseVideoInfo } from "../src/videos";
import {
  createTestApp,
  ffmpegInfo,
  mutate,
  newTripInput,
  query,
  signUp,
  upload,
  videoWithLocation,
  type TestContext,
  type TestUser,
} from "./helpers";

type MediaDto = { id: string; kind: string; url: string | null; thumbUrl: string | null; durationMs: number | null };
type PostDto = { id: string; media: MediaDto[] };

describe("video (Could)", () => {
  let t: TestContext;
  let sara: TestUser;
  let ole: TestUser;
  const trip = newTripInput();

  beforeAll(async () => {
    t = await createTestApp();
    sara = await signUp(t.app, "Sara");
    ole = await signUp(t.app, "Ole");
    await mutate(t.app, "trips.create", trip, sara);
  });

  afterAll(() => t.close());

  it("gemmer videoen uden GPS-position og med en plakatramme (sikkerhedsrisiko 3)", async () => {
    const input = await videoWithLocation();
    expect(await ffmpegInfo(input)).toContain("+41.9009+012.4833"); // testvideoen har faktisk en position

    const mediaId = randomUUID();
    const res = await upload(
      t.app,
      sara,
      { tripId: trip.id, mediaId, kind: "video" },
      { data: input, type: "video/mp4" },
      null,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ mediaId, width: 320, height: 240 });

    const video = t.storage.objects.get(`trips/${trip.id}/${mediaId}.mp4`);
    const poster = t.storage.objects.get(`trips/${trip.id}/${mediaId}_thumb.jpg`);
    expect(video && poster).toBeTruthy();
    const info = await ffmpegInfo(video!);
    expect(info).not.toContain("41.9009");
    expect(info).not.toMatch(/location|Trevi/);
    expect(info).toMatch(/Video: h264/);
    expect(info).toMatch(/Audio: aac/);
    const posterMeta = await sharp(Buffer.from(poster!)).metadata();
    expect(posterMeta.format).toBe("jpeg");
    expect([posterMeta.width, posterMeta.height]).toEqual([320, 240]);

    const row = await t.db.media.findUniqueOrThrow({ where: { id: mediaId } });
    expect(row).toMatchObject({ kind: "video", mimeType: "video/mp4", durationMs: 2000 });
  });

  it("portræt-video: rotationen bevares, og mål og plakat er på højkant", async () => {
    const mediaId = randomUUID();
    const res = await upload(
      t.app,
      sara,
      { tripId: trip.id, mediaId, kind: "video" },
      { data: await videoWithLocation({ rotate: 90 }), type: "video/quicktime" },
      null,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ width: 240, height: 320 });
    expect(await ffmpegInfo(t.storage.objects.get(`trips/${trip.id}/${mediaId}.mp4`)!)).toMatch(/rotation of/);
    const posterMeta = await sharp(Buffer.from(t.storage.objects.get(`trips/${trip.id}/${mediaId}_thumb.jpg`)!)).metadata();
    expect([posterMeta.width, posterMeta.height]).toEqual([240, 320]);
  });

  it("lyd, MP4 ikke kan rumme (fx AMR fra Androids kamera), genkodes til AAC", async () => {
    const input = await videoWithLocation({ audio: "libopencore_amrnb", rotate: 90 });
    expect(await ffmpegInfo(input)).toMatch(/Audio: amr_nb/);
    const mediaId = randomUUID();
    const res = await upload(t.app, sara, { tripId: trip.id, mediaId, kind: "video" }, { data: input, type: "video/3gpp" }, null);
    expect(res.statusCode).toBe(201);
    const info = await ffmpegInfo(t.storage.objects.get(`trips/${trip.id}/${mediaId}.mp4`)!);
    expect(info).toMatch(/Video: h264/);
    expect(info).toMatch(/Audio: aac/);
    expect(info).not.toContain("41.9009");
  });

  it("indlægget får videoen med type og varighed", async () => {
    const mediaId = randomUUID();
    await upload(t.app, sara, { tripId: trip.id, mediaId, kind: "video" }, { data: await videoWithLocation(), type: "video/mp4" }, null);
    const created = await mutate<PostDto>(
      t.app,
      "posts.create",
      { id: mediaId, tripId: trip.id, text: "Trevi", takenAt: new Date().toISOString(), lat: null, lon: null, mediaId },
      sara,
    );
    expect(created.ok).toBe(true);
    const list = await query<PostDto[]>(t.app, "posts.list", { tripId: trip.id }, sara);
    const post = list.ok ? list.data.find((p) => p.id === mediaId) : undefined;
    expect(post?.media[0]).toMatchObject({ id: mediaId, kind: "video", durationMs: 2000 });
    expect(post?.media[0]?.url).toMatch(/\.mp4\?/);
    expect(post?.media[0]?.thumbUrl).toMatch(/_thumb\.jpg\?/);

    // Sletning fjerner både video og plakat fra bucket'en.
    await mutate(t.app, "posts.delete", { tripId: trip.id, postId: mediaId }, sara);
    expect(t.storage.objects.has(`trips/${trip.id}/${mediaId}.mp4`)).toBe(false);
    expect(t.storage.objects.has(`trips/${trip.id}/${mediaId}_thumb.jpg`)).toBe(false);
  });

  it("afviser videoer over 30 sekunder", async () => {
    const res = await upload(
      t.app,
      sara,
      { tripId: trip.id, mediaId: randomUUID(), kind: "video" },
      { data: await videoWithLocation({ seconds: 33, width: 64, height: 64 }), type: "video/mp4" },
      null,
    );
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toMatch(/30 sekunder/);
  });

  it("afviser filer, der ikke er videoer – også når klienten påstår det", async () => {
    const res = await upload(
      t.app,
      sara,
      { tripId: trip.id, mediaId: randomUUID(), kind: "video" },
      { data: Buffer.from("ikke en video"), type: "video/mp4" },
      null,
    );
    expect(res.statusCode).toBe(415);
  });

  it("ikke-medlemmer kan ikke uploade video til rejsen", async () => {
    const mediaId = randomUUID();
    const res = await upload(
      t.app,
      ole,
      { tripId: trip.id, mediaId, kind: "video" },
      { data: await videoWithLocation(), type: "video/mp4" },
      null,
    );
    expect(res.statusCode).toBe(404);
    expect(await t.db.media.count({ where: { id: mediaId } })).toBe(0);
  });

  it("et billede over 15 MB afvises stadig, selvom videoer må være større", async () => {
    const res = await upload(
      t.app,
      sara,
      { tripId: trip.id, mediaId: randomUUID(), kind: "photo" },
      { data: Buffer.alloc(16 * 1024 * 1024, 1), type: "image/jpeg" },
    );
    expect(res.statusCode).toBe(413);
  });
});

describe("parseVideoInfo", () => {
  it("læser codec, mål og varighed og bytter mål ved rotation", () => {
    const log = `Duration: 00:00:12.48, start: 0.000000
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv), 1920x1080, 9000 kb/s
      displaymatrix: rotation of -90.00 degrees`;
    expect(parseVideoInfo(log)).toEqual({
      codec: "hevc",
      audioCodec: null,
      width: 1080,
      height: 1920,
      durationMs: 12480,
    });
  });

  it("læser lydens codec", () => {
    const log = `Duration: 00:00:02.62, start: 0.000000
  Stream #0:0[0x1](eng): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1280x720, 915 kb/s
  Stream #0:1[0x2](eng): Audio: amr_nb (samr / 0x726D6173), 8000 Hz, mono, fltp, 12 kb/s (default)`;
    expect(parseVideoInfo(log)).toMatchObject({ codec: "h264", audioCodec: "amr_nb", width: 1280, height: 720 });
  });

  it("giver null uden videospor", () => {
    expect(parseVideoInfo("Duration: 00:00:02.00\n  Stream #0:0: Audio: aac")).toBeNull();
  });
});

describe("parseRange (videoafspilning fra lokal udviklingslagring)", () => {
  it.each([
    ["bytes=0-99", { start: 0, end: 99 }],
    ["bytes=100-", { start: 100, end: 999 }],
    ["bytes=-100", { start: 900, end: 999 }],
    ["bytes=0-5000", { start: 0, end: 999 }],
  ])("%s", (header, expected) => {
    expect(parseRange(header, 1000)).toEqual(expected);
  });

  it("ugyldige intervaller", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("invalid");
    expect(parseRange("bytes=5-2", 1000)).toBe("invalid");
    expect(parseRange("items=0-1", 1000)).toBe("invalid");
    expect(parseRange(undefined, 1000)).toBeNull();
  });
});
