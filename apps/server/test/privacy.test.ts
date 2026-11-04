import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, signUp, type TestContext } from "./helpers";

/** Følsomme data må ikke ende i URL'er og logs, og cookien må ikke følge med fra fremmede sites. */
describe("logs og cookies", () => {
  let t: TestContext;
  const logLines: string[] = [];

  beforeAll(async () => {
    t = await createTestApp({ logger: { stream: { write: (line) => void logLines.push(line) } } });
  });

  afterAll(() => t.close());

  it("logger stien, men aldrig query-strengen", async () => {
    await t.app.inject({ method: "GET", url: "/?input=41.8902&sig=hemmelig-signatur" });
    const log = logLines.join("\n");
    expect(log).toContain('"url":"/"');
    expect(log).not.toContain("41.8902");
    expect(log).not.toContain("hemmelig-signatur");
  });

  it("enrich.preview kan ikke kaldes med koordinater i URL'en", async () => {
    const sara = await signUp(t.app, "Sara");
    const input = encodeURIComponent(JSON.stringify({ lat: 41.89, lon: 12.49, takenAt: "2026-05-14T10:00:00Z" }));
    const res = await t.app.inject({
      method: "GET",
      url: `/trpc/enrich.preview?input=${input}`,
      headers: { cookie: sara.cookie },
    });
    expect(res.statusCode).toBe(405);
  });

  it("session-cookien er SameSite=Lax", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: "http://localhost:3001", "content-type": "application/json" },
      payload: { name: "Cookie", email: `cookie-${Date.now()}@test.dk`, password: "hemmelig123" },
    });
    const setCookie = [res.headers["set-cookie"]].flat().join("\n");
    expect(setCookie).toContain("session_token");
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/SameSite=None/i);
  });
});
