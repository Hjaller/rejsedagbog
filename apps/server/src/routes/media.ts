import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import type { FastifyInstance } from "fastify";

import type { LocalMediaStorage } from "../storage-local";

/** "bytes=START-END", "bytes=START-" eller "bytes=-SUFFIX". Kun ét interval. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

/**
 * GET /api/media/* – udleverer billeder og videoer fra den lokale udviklingslagring via
 * signerede links. Range-forespørgsler understøttes, fordi videoafspillere (især iOS)
 * kræver dem – ligesom S3 gør i drift.
 */
export function registerLocalMediaRoute(app: FastifyInstance, storage: LocalMediaStorage) {
  app.get<{ Params: { "*": string }; Querystring: { exp?: string; sig?: string } }>(
    "/api/media/*",
    async (request, reply) => {
      const key = request.params["*"];
      const file = storage.resolveSigned(key, request.query.exp ?? "", request.query.sig ?? "");
      if (!file) return reply.status(403).send({ error: "Linket er ugyldigt eller udløbet", code: "FORBIDDEN" });
      let size: number;
      try {
        size = (await stat(file)).size;
      } catch {
        return reply.status(404).send({ error: "Filen findes ikke", code: "NOT_FOUND" });
      }
      reply
        .header("content-type", key.endsWith(".mp4") ? "video/mp4" : "image/jpeg")
        .header("accept-ranges", "bytes")
        .header("cache-control", "private, max-age=900");

      const range = parseRange(request.headers.range, size);
      if (range === "invalid") {
        return reply.status(416).header("content-range", `bytes */${size}`).send();
      }
      if (range) {
        return reply
          .status(206)
          .header("content-range", `bytes ${range.start}-${range.end}/${size}`)
          .header("content-length", range.end - range.start + 1)
          .send(createReadStream(file, { start: range.start, end: range.end }));
      }
      return reply.header("content-length", size).send(createReadStream(file));
    },
  );
}
