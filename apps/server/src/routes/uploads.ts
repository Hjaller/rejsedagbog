import type { MediaStorage } from "@rejsedagbog/api/storage";
import { mediaKeys } from "@rejsedagbog/api/storage";
import { getTripMembership } from "@rejsedagbog/api/trip-access";
import type { Database } from "@rejsedagbog/db";
import { UPLOAD_ALLOWED_MIME_TYPES } from "@rejsedagbog/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { processImage, UnsupportedImageError } from "../images";

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
});

export type UploadResponse = { mediaId: string; width: number | null; height: number | null };

function fail(reply: FastifyReply, status: number, code: string, error: string) {
  return reply.status(status).send({ error, code });
}

/**
 * POST /api/uploads (multipart: tripId, mediaId, file).
 * Tjekker session og medlemskab af rejsen, validerer filtype og størrelse, fjerner
 * EXIF, laver en thumbnail og lægger begge i bucket'en (udviklingsplan afsnit 1).
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

      // Læs felter og fil. @fastify/multipart håndhæver UPLOAD_MAX_BYTES under læsningen.
      const fields: Record<string, string> = {};
      let file: { buffer: Buffer; mimetype: string } | null = null;
      try {
        for await (const part of request.parts()) {
          if (part.type === "file") {
            if (file) return fail(reply, 400, "BAD_REQUEST", "Kun én fil pr. upload");
            file = { buffer: await part.toBuffer(), mimetype: part.mimetype };
          } else {
            fields[part.fieldname] = String(part.value);
          }
        }
      } catch (err) {
        if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
          return fail(reply, 413, "FILE_TOO_LARGE", "Billedet er for stort");
        }
        throw err;
      }

      const parsed = fieldsSchema.safeParse(fields);
      if (!parsed.success) return fail(reply, 400, "BAD_REQUEST", "Ugyldig upload");
      const { tripId, mediaId } = parsed.data;

      // Samme svar for "findes ikke" og "ikke medlem", så rejse-id'er ikke kan gættes.
      const membership = await getTripMembership(deps.db, userId, tripId);
      if (!membership) return fail(reply, 404, "NOT_FOUND", "Rejsen findes ikke");

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
      if (!(UPLOAD_ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
        return fail(reply, 415, "UNSUPPORTED_MEDIA_TYPE", "Billedformatet understøttes ikke");
      }

      let image;
      try {
        image = await processImage(file.buffer);
      } catch (err) {
        if (err instanceof UnsupportedImageError) {
          return fail(reply, 415, "UNSUPPORTED_MEDIA_TYPE", err.message);
        }
        throw err;
      }

      const { key, thumbKey } = mediaKeys(tripId, mediaId);
      await deps.storage.put(key, image.full, "image/jpeg");
      await deps.storage.put(thumbKey, image.thumb, "image/jpeg");

      await deps.db.media.create({
        data: {
          id: mediaId,
          tripId,
          uploaderId: userId,
          kind: "photo",
          key,
          thumbKey,
          mimeType: "image/jpeg",
          sizeBytes: image.full.byteLength,
          width: image.width,
          height: image.height,
        },
      });

      return reply.status(201).send({
        mediaId,
        width: image.width,
        height: image.height,
      } satisfies UploadResponse);
    },
  );
}
