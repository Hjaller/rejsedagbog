import { SESSION_EXPIRES_IN_SECONDS, SESSION_UPDATE_AGE_SECONDS } from "@rejsedagbog/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, query, signUp, type TestContext, type TestUser } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("sessionens levetid", () => {
  let t: TestContext;
  let sara: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
    sara = await signUp(t.app, "Sara");
  });
  afterAll(() => t.close());

  const session = () => t.db.session.findFirstOrThrow({ where: { userId: sara.id } });

  it("er 7 dage, og forlænges højst én gang i døgnet", () => {
    expect(SESSION_EXPIRES_IN_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(SESSION_UPDATE_AGE_SECONDS).toBe(24 * 60 * 60);
  });

  it("en ny session udløber 7 dage efter login", async () => {
    const msLeft = (await session()).expiresAt.getTime() - Date.now();
    expect(msLeft).toBeGreaterThan(7 * DAY_MS - 60_000);
    expect(msLeft).toBeLessThanOrEqual(7 * DAY_MS);
  });

  it("cookien med tokenet har samme udløb og er HttpOnly og Secure", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      remoteAddress: "198.51.100.7",
      headers: { origin: "http://localhost:3001", "content-type": "application/json" },
      payload: { email: (await t.db.user.findUniqueOrThrow({ where: { id: sara.id } })).email, password: "hemmelig123" },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = [res.headers["set-cookie"] ?? []].flat();
    const token = setCookie.find((c) => c.includes("session_token"));
    expect(token).toMatch(/Max-Age=604800/);
    expect(token).toMatch(/HttpOnly/i);
    expect(token).toMatch(/Secure/i);
    expect(token).toMatch(/SameSite=Lax/i);
  });

  it("en frisk session forlænges ikke ved brug", async () => {
    const before = (await session()).expiresAt.getTime();
    expect((await query(t.app, "trips.list", null, sara)).ok).toBe(true);
    expect((await session()).expiresAt.getTime()).toBe(before);
  });

  it("en session, der er over et døgn gammel, forlænges til 7 dage ved brug", async () => {
    const { id } = await session();
    await t.db.session.update({ where: { id }, data: { expiresAt: new Date(Date.now() + 5 * DAY_MS) } });
    expect((await query(t.app, "trips.list", null, sara)).ok).toBe(true);
    const msLeft = (await session()).expiresAt.getTime() - Date.now();
    expect(msLeft).toBeGreaterThan(7 * DAY_MS - 60_000);
  });

  it("en udløbet session afvises af serveren", async () => {
    const { id } = await session();
    await t.db.session.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await query(t.app, "trips.list", null, sara);
    expect(res).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });
});
