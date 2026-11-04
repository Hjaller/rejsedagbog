import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import type { Context as ApiContext } from "@rejsedagbog/api/context";
import { appRouter, type AppRouter } from "@rejsedagbog/api/routers/index";
import type { MediaStorage } from "@rejsedagbog/api/storage";
import type { createAuth } from "@rejsedagbog/auth";
import type { Database } from "@rejsedagbog/db";
import { UPLOAD_MAX_BYTES } from "@rejsedagbog/shared";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import { fromNodeHeaders } from "better-auth/node";
import Fastify, { type FastifyServerOptions } from "fastify";

import { registerAuthRoutes } from "./routes/auth";
import { registerLocalMediaRoute } from "./routes/media";
import { registerUploadRoute } from "./routes/uploads";
import type { LocalMediaStorage } from "./storage-local";

export type Auth = ReturnType<typeof createAuth>;

export type AppDeps = {
  db: Database;
  auth: Auth;
  /** S3 i drift; lokal fil-lagring i udvikling uden S3; null = billeder slået fra. */
  storage: MediaStorage | null;
  restCountriesApiKey: string | null;
  corsOrigin: string;
  /** Sæt til true bag en reverse proxy, så request.ip er klientens IP. */
  trustProxy?: boolean;
  logger?: FastifyServerOptions["logger"];
  rateLimits?: { trpcPerMinute: number; uploadsPerMinute: number };
};

/**
 * Bygger Fastify-appen uden at starte den, så integrationstests kan bruge
 * `app.inject()` med deres egen database og et falsk billedlager.
 */
export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: deps.logger ?? true,
    trustProxy: deps.trustProxy ?? false,
    bodyLimit: 1024 * 1024,
  });
  const limits = deps.rateLimits ?? { trpcPerMinute: 300, uploadsPerMinute: 60 };

  // tRPC-ruterne oprettes af et plugin, så de får rate limit-config her. Hooken skal
  // registreres før @fastify/rate-limit, som også læser config i onRoute.
  app.addHook("onRoute", (route) => {
    if (route.url.startsWith("/trpc")) {
      route.config = {
        ...route.config,
        rateLimit: { max: limits.trpcPerMinute, timeWindow: "1 minute" },
      } as typeof route.config;
    }
  });

  await app.register(fastifyCors, {
    origin: deps.corsOrigin,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
    maxAge: 86400,
  });

  // Rate limiting pr. route (login har sin egen i Better Auth).
  await app.register(fastifyRateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: "For mange forespørgsler. Vent lidt, og prøv igen.",
      code: "RATE_LIMITED",
      retryAfterSeconds: Math.ceil(ctx.ttl / 1000),
    }),
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: UPLOAD_MAX_BYTES, files: 1, fields: 5, fieldSize: 200 },
  });

  const getSession = (headers: Record<string, string | string[] | undefined>) =>
    deps.auth.api.getSession({ headers: fromNodeHeaders(headers) });

  registerAuthRoutes(app, deps.auth);

  registerUploadRoute(app, {
    db: deps.db,
    storage: deps.storage,
    getSession,
    perMinute: limits.uploadsPerMinute,
  });

  if (deps.storage && "isLocal" in deps.storage) {
    registerLocalMediaRoute(app, deps.storage as LocalMediaStorage);
  }

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      async createContext({ req }): Promise<ApiContext> {
        return {
          db: deps.db,
          session: await getSession(req.headers),
          storage: deps.storage,
          restCountriesApiKey: deps.restCountriesApiKey,
        };
      },
      onError({ path, error }) {
        // Detaljer logges kun her; klienten får en generisk besked (errorFormatter i @rejsedagbog/api).
        if (error.code === "INTERNAL_SERVER_ERROR") {
          app.log.error({ err: error.cause ?? error, path }, "tRPC-fejl");
        }
      },
    } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
  });

  app.get("/", async () => "OK");

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
