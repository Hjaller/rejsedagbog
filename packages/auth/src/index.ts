import { expo } from "@better-auth/expo";
import type { Database } from "@rejsedagbog/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  return betterAuth({
    database: prismaAdapter(database, {
      provider: "postgresql",
    }),
    trustedOrigins: [
      env.CORS_ORIGIN,
      ...desktopOrigins,
      "rejsedagbog://",
      "exp://",
      "http://localhost:8081",
    ],
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    // Rate limiting på login (kravspec afsnit 4). Slået til i alle miljøer, så det kan testes lokalt.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      // Serveren sætter denne header ud fra Fastifys request.ip (se apps/server/src/routes/auth.ts).
      ipAddress: { ipAddressHeaders: ["x-rejsepost-client-ip"] },
      defaultCookieAttributes: {
        // Web og API deployes bag samme reverse proxy. Appen sender cookien selv.
        sameSite: "lax",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [expo()],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
