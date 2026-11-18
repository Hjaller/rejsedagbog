import { generateKeyPairSync } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestContext } from "./helpers";

const ORIGIN = "http://localhost:3001";

/** Det, appen sender, når brugeren trykker "Fortsæt med ...". Hver udbyder får sin egen IP pga. rate limit. */
function startLogin(t: TestContext, provider: "google" | "apple", remoteAddress: string) {
  return t.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/social",
    remoteAddress,
    headers: { origin: ORIGIN, "content-type": "application/json" },
    payload: { provider, callbackURL: "rejsedagbog:///" },
  });
}

describe("login med Google og Apple", () => {
  let t: TestContext;

  beforeAll(async () => {
    // Apple kræver en rigtig ES256-nøgle til client secret'en; \n som i en .env-fil.
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    t = await createTestApp(
      {},
      {
        GOOGLE_CLIENT_ID: "google-test-id",
        GOOGLE_CLIENT_SECRET: "google-test-secret",
        APPLE_CLIENT_ID: "dev.leth.rejsepost.login",
        APPLE_TEAM_ID: "TEAM123456",
        APPLE_KEY_ID: "KEY1234567",
        APPLE_PRIVATE_KEY: pem.trim().replace(/\n/g, "\\n"),
      },
    );
  });

  afterAll(() => t.close());

  it("sender brugeren til Google med serverens callback-adresse", async () => {
    const res = await startLogin(t, "google", "203.0.113.10");
    expect(res.statusCode).toBe(200);
    const url = new URL(res.json().url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("google-test-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/google");
  });

  it("sender brugeren til Apple og beder om svaret som en formular", async () => {
    const res = await startLogin(t, "apple", "203.0.113.11");
    expect(res.statusCode).toBe(200);
    const url = new URL(res.json().url);
    expect(url.origin).toBe("https://appleid.apple.com");
    expect(url.searchParams.get("client_id")).toBe("dev.leth.rejsepost.login");
    expect(url.searchParams.get("response_mode")).toBe("form_post");
  });

  it("tager imod Apples formular-svar og sender det videre som en GET", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/callback/apple",
      remoteAddress: "203.0.113.12",
      headers: { origin: "https://appleid.apple.com", "content-type": "application/x-www-form-urlencoded" },
      payload: "code=abc123&state=xyz789",
    });
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location as string);
    expect(location.pathname).toBe("/api/auth/callback/apple");
    expect(location.searchParams.get("code")).toBe("abc123");
    expect(location.searchParams.get("state")).toBe("xyz789");
  });

  it("tager ikke imod formular-data uden for /api/auth", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/trpc/trips.create",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      payload: "name=Rom",
    });
    expect(res.statusCode).toBe(415);
  });
});

describe("uden GOOGLE_* og APPLE_*", () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  it.each(["google", "apple"] as const)("svarer 404 på login med %s", async (provider) => {
    const res = await startLogin(t, provider, provider === "google" ? "203.0.113.20" : "203.0.113.21");
    expect(res.statusCode).toBe(404);
  });
});
