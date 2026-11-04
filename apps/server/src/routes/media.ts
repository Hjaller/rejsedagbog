import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import type { FastifyInstance } from "fastify";

import type { LocalMediaStorage } from "../storage-local";

/** GET /api/media/* – udleverer billeder fra den lokale udviklingslagring via signerede links. */
export function registerLocalMediaRoute(app: FastifyInstance, storage: LocalMediaStorage) {
  app.get<{ Params: { "*": string }; Querystring: { exp?: string; sig?: string } }>(
    "/api/media/*",
    async (request, reply) => {
      const file = storage.resolveSigned(request.params["*"], request.query.exp ?? "", request.query.sig ?? "");
      if (!file) return reply.status(403).send({ error: "Linket er ugyldigt eller udløbet", code: "FORBIDDEN" });
      try {
        const info = await stat(file);
        return reply
          .header("content-type", "image/jpeg")
          .header("content-length", info.size)
          .header("cache-control", "private, max-age=900")
          .send(createReadStream(file));
      } catch {
        return reply.status(404).send({ error: "Billedet findes ikke", code: "NOT_FOUND" });
      }
    },
  );
}
