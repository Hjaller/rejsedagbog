import type { FastifyInstance } from "fastify";

import type { Auth } from "../app";

/** Header, som kun serveren sætter, så Better Auth kan rate-limite pr. klient-IP. */
export const CLIENT_IP_HEADER = "x-rejsepost-client-ip";

/** Videresender /api/auth/* til Better Auth. */
export function registerAuthRoutes(app: FastifyInstance, auth: Auth) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (value && key !== CLIENT_IP_HEADER) headers.append(key, value.toString());
        }
        // request.ip følger Fastifys trustProxy. Den må kun stole på vores egen proxy,
        // ellers kan klienten forfalske sin IP med X-Forwarded-For (se trust-proxy.ts).
        headers.set(CLIENT_IP_HEADER, request.ip);

        const response = await auth.handler(
          new Request(url.toString(), {
            method: request.method,
            headers,
            body: request.body ? JSON.stringify(request.body) : undefined,
          }),
        );
        reply.status(response.status);
        response.headers.forEach((value, key) => {
          if (key !== "set-cookie") reply.header(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) reply.header("set-cookie", cookies);
        return reply.send(response.body ? await response.text() : null);
      } catch (error) {
        request.log.error({ err: error }, "Fejl i login-håndteringen");
        return reply.status(500).send({ error: "Der skete en fejl. Prøv igen.", code: "AUTH_FAILURE" });
      }
    },
  });
}
