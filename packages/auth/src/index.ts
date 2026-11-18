import { expo } from "@better-auth/expo";
import type { Database } from "@rejsedagbog/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { importPKCS8, SignJWT } from "jose";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
  /** Login med Google er slået til, når begge er sat. */
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  /** Login med Apple er slået til, når alle fire er sat. APPLE_CLIENT_ID er Service ID'et. */
  APPLE_CLIENT_ID?: string | undefined;
  APPLE_TEAM_ID?: string | undefined;
  APPLE_KEY_ID?: string | undefined;
  /** Indholdet af .p8-nøglen. Linjeskift må stå som "\n". */
  APPLE_PRIVATE_KEY?: string | undefined;
};

const APPLE_ORIGIN = "https://appleid.apple.com";
/** Apple afviser client secrets, der gælder længere end seks måneder. */
const APPLE_SECRET_LIFETIME_SECONDS = 180 * 24 * 60 * 60;

/** Apple bruger en JWT signeret med .p8-nøglen som client secret. */
async function appleClientSecret(clientId: string, teamId: string, keyId: string, privateKey: string) {
  const key = await importPKCS8(privateKey.replace(/\\n/g, "\n").trim(), "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId)
    .setAudience(APPLE_ORIGIN)
    .setIssuedAt(now)
    .setExpirationTime(now + APPLE_SECRET_LIFETIME_SECONDS)
    .sign(key);
}

/** Kun de udbydere, der er sat miljøvariabler for. Uden dem svarer /sign-in/social 404. */
function socialProviders(env: AuthConfig) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } =
    env;
  return {
    ...(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            // Lader brugeren vælge konto hver gang, så man kan skifte konto på en delt telefon.
            prompt: "select_account" as const,
          },
        }
      : {}),
    ...(APPLE_CLIENT_ID && APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY
      ? {
          // Laves én gang ved opstart og gælder i 180 dage. Serveren skal altså genstartes inden da.
          apple: async () => ({
            clientId: APPLE_CLIENT_ID,
            clientSecret: await appleClientSecret(APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY),
          }),
        }
      : {}),
  };
}

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  const providers = socialProviders(env);
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
      // Apple sender brugeren tilbage med en POST fra deres eget domæne.
      ...("apple" in providers ? [APPLE_ORIGIN] : []),
    ],
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    // En Google- eller Apple-konto kobles ikke på en eksisterende konto med samme e-mail
    // (Better Auths standard, requireLocalEmailVerified), fordi appen ikke bekræfter e-mails:
    // ellers kunne man oprette en konto i en andens e-mail og vente på, at de logger ind.
    socialProviders: providers,
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
