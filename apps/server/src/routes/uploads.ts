import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { MediaStorage } from "@rejsedagbog/api/storage";
import { mediaKeys } from "@rejsedagbog/api/storage";
import { canContribute, getTripMembership } from "@rejsedagbog/api/trip-access";
import type { Database } from "@rejsedagbog/db";
import {
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_MAX_BYTES,
  VIDEO_ALLOWED_MIME_TYPES,
  type MediaKind,
} from "@rejsedagbog/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { processImage, UnsupportedImageError } from "../images";
import { processVideo, UnsupportedVideoError } from "../videos";

type Session = { user: { id: string } } | null;

type UploadDeps = {
  db: Database;
  storage: MediaStorage | null;
  getSession: (headers: Record<string, string | string[] | undefined>) => Promise<Session>;
  perMinute: number;
  corsOrigin: string;
};

const fieldsSchema = z.object({
  tripId: z.uuid(),
  /** Genereres af appen. Samme id ved retry → ingen dubletter eller forældreløse filer. */
  mediaId: z.uuid(),
  /** Mangler den, afgøres det af filens mimetype (ældre app-versioner sender kun billeder). */
  kind: z.enum(["photo", "video"]).optional(),
});

export type UploadResponse = { mediaId: string; width: number | null; height: number | null };

function fail(reply: FastifyReply, status: number, code: string, error: string) {
  return reply.status(status).send({ error, code });
}

class FileTooLargeError extends Error {}

/**
 * Læser et billede i hukommelsen, men gemmer højst `max` bytes (videoer må være større,
 * så multipart-grænsen er højere). Resten læses og smides væk, så multipart-parseren
 * kan afslutte forespørgslen, og så afvises filen.
 */
async function readLimited(stream: Readable, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += (chunk as Buffer).length;
    if (size <= max) chunks.push(chunk as Buffer);
  }
  if (size > max) throw new FileTooLargeError();
  return Buffer.concat(chunks);
}

type ReceivedFile =
  | { kind: "photo"; mimetype: string; buffer: Buffer }
  | { kind: "video"; mimetype: string; path: string; truncated: boolean };

/**
 * POST /api/uploads (multipart: tripId, mediaId, kind?, file).
 * Tjekker session og medlemskab af rejsen (ikke kun visning) og validerer filtype og størrelse.
 * Billeder: EXIF fjernes, og der laves en thumbnail. Videoer (Could): metadata
 * fjernes med ffmpeg, og der laves en plakatramme. Begge dele lægges i bucket'en.
 */
export function registerUploadRoute(app: FastifyInstance, deps: UploadDeps) {
  app.post(
    "/api/uploads",
    { config: { rateLimit: { max: deps.perMinute, timeWindow: "1 minute" } } },
    async (request, reply) => {
      // CSRF: browsere sender altid Origin ved POST på tværs af sites, appen sender ingen.
      // Multipart udløser ingen CORS-preflight, så CORS alene stopper ikke forespørgslen.
      const origin = request.headers.origin;
      if (origin && origin !== deps.corsOrigin) {
        return fail(reply, 403, "FORBIDDEN_ORIGIN", "Upload er ikke tilladt herfra");
      }

      const session = await deps.getSession(request.headers);
      if (!session) return fail(reply, 401, "UNAUTHORIZED", "Du skal være logget ind");
      const userId = session.user.id;

      if (!request.isMultipart()) {
        return fail(reply, 400, "BAD_REQUEST", "Forventede multipart/form-data");
      }

      // En video skrives til en midlertidig mappe, som altid ryddes op.
      let tmpDir: string | null = null;
      try {
        // Læs felter og fil. @fastify/multipart håndhæver VIDEO_MAX_BYTES; billeder stoppes ved UPLOAD_MAX_BYTES.
        const fields: Record<string, string> = {};
        let file: ReceivedFile | null = null;
        try {
          for await (const part of request.parts()) {
            if (part.type === "file") {
              if (file) return fail(reply, 400, "BAD_REQUEST", "Kun én fil pr. upload");
              // Appen sender felterne før filen, så "kind" er kendt her.
              const isVideo = fields.kind ? fields.kind === "video" : part.mimetype.startsWith("video/");
              if (isVideo) {
                tmpDir = await mkdtemp(path.join(tmpdir(), "rejsepost-"));
                const tmpPath = path.join(tmpDir, "upload");
                await pipeline(part.file, createWriteStream(tmpPath));
                file = { kind: "video", mimetype: part.mimetype, path: tmpPath, truncated: part.file.truncated };
              } else {
                file = { kind: "photo", mimetype: part.mimetype, buffer: await readLimited(part.file, UPLOAD_MAX_BYTES) };
              }
            } else {
              fields[part.fieldname] = String(part.value);
            }
          }
        } catch (err) {
          if (err instanceof FileTooLargeError || (err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
            return fail(reply, 413, "FILE_TOO_LARGE", tmpDir ? "Videoen er for stor" : "Billedet er for stort");
          }
          throw err;
        }

        const parsed = fieldsSchema.safeParse(fields);
        if (!parsed.success) return fail(reply, 400, "BAD_REQUEST", "Ugyldig upload");
        const { tripId, mediaId } = parsed.data;

        // Samme svar for "findes ikke" og "ikke medlem", så rejse-id'er ikke kan gættes.
        const membership = await getTripMembership(deps.db, userId, tripId);
        if (!membership) return fail(reply, 404, "NOT_FOUND", "Rejsen findes ikke");
        // Delt til visning: må se rejsen, men ikke lægge billeder op.
        if (!canContribute(membership.role)) {
          return fail(reply, 403, "FORBIDDEN", "Du kan se rejsen, men ikke lægge billeder op");
        }

        if (!deps.storage) {
          return fail(reply, 503, "STORAGE_UNAVAILABLE", "Billeder kan ikke gemmes lige nu");
        }

        const existing = await deps.db.media.findUnique({ where: { id: mediaId } });
        if (existing) {
          if (existing.uploaderId !== userId || existing.tripId !== tripId) {
            return fail(reply, 409, "CONFLICT", "Billed-id'et er allerede i brug");
          }
          // Retry af en upload, der lykkedes: svar som første gang.
          return reply.status(200).send({
            mediaId: existing.id,
            width: existing.width,
            height: existing.height,
          } satisfies UploadResponse);
        }

        if (!file) return fail(reply, 400, "BAD_REQUEST", "Der mangler et billede");
        if (file.kind === "video") {
          if (file.truncated) return fail(reply, 413, "FILE_TOO_LARGE", "Videoen er for stor");
          if (!(VIDEO_ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype) && !fields.kind) {
            return fail(reply, 415, "UNSUPPORTED_MEDIA_TYPE", "Videoformatet understøttes ikke");
          }
          return await storeVideo(reply, deps.db, deps.storage, { tripId, mediaId, userId, inputPath: file.path });
        }

        if (!(UPLOAD_ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
          return fail(reply, 415, "UNSUPPORTED_MEDIA_TYPE", "Billedformatet understøttes ikke");
        }
        return await storePhoto(reply, deps.db, deps.storage, { tripId, mediaId, userId, buffer: file.buffer });
      } finally {
        if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );
}

type StoreArgs = { tripId: string; mediaId: string; userId: string };

async function storePhoto(
  reply: FastifyReply,
  db: Database,
  storage: MediaStorage,
  { tripId, mediaId, userId, buffer }: StoreArgs & { buffer: Buffer },
) {
  let image;
  try {
    image = await processImage(buffer);
  } catch (err) {
    if (err instanceof UnsupportedImageError) return fail(reply, 415, "UNSUPPORTED_MEDIA_TYPE", err.message);
    throw err;
  }

  const { key, thumbKey } = mediaKeys(tripId, mediaId, "photo");
  await storage.put(key, image.full, "image/jpeg");
  await storage.put(thumbKey, image.thumb, "image/jpeg");
  await createMedia(db, { tripId, mediaId, userId }, "photo", {
    key,
    thumbKey,
    mimeType: "image/jpeg",
    sizeBytes: image.full.byteLength,
    width: image.width,
    height: image.height,
    durationMs: null,
  });
  return reply.status(201).send({ mediaId, width: image.width, height: image.height } satisfies UploadResponse);
}

async function storeVideo(
  reply: FastifyReply,
  db: Database,
  storage: MediaStorage,
  { tripId, mediaId, userId, inputPath }: StoreArgs & { inputPath: string },
) {
  let video;
  try {
    video = await processVideo(inputPath, `${inputPath}.mp4`);
  } catch (err) {
    if (err instanceof UnsupportedVideoError) return fail(reply, 415, "UNSUPPORTED_MEDIA_TYPE", err.message);
    throw err;
  }

  const { key, thumbKey } = mediaKeys(tripId, mediaId, "video");
  await storage.put(key, video.video, "video/mp4");
  await storage.put(thumbKey, video.poster, "image/jpeg");
  await createMedia(db, { tripId, mediaId, userId }, "video", {
    key,
    thumbKey,
    mimeType: "video/mp4",
    sizeBytes: video.video.byteLength,
    width: video.width,
    height: video.height,
    durationMs: video.durationMs,
  });
  return reply.status(201).send({ mediaId, width: video.width, height: video.height } satisfies UploadResponse);
}

function createMedia(
  db: Database,
  { tripId, mediaId, userId }: StoreArgs,
  kind: MediaKind,
  data: {
    key: string;
    thumbKey: string;
    mimeType: string;
    sizeBytes: number;
    width: number;
    height: number;
    durationMs: number | null;
  },
) {
  return db.media.create({ data: { id: mediaId, tripId, uploaderId: userId, kind, ...data } });
}
