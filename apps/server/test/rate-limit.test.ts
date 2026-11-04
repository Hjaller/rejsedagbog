import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, signUp, type TestContext } from "./helpers";

describe("rate limiting på login", () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  it("giver 429 efter 5 forkerte loginforsøg inden for et minut", async () => {
    const user = await signUp(t.app, "Bruteforce");
    const attempt = () =>
      t.app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { origin: "http://localhost:3001", "content-type": "application/json" },
        payload: { email: `${user.name}@test.dk`, password: "forkert-kode" },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await attempt()).statusCode);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("klienten kan ikke omgå grænsen ved at sætte IP-headeren selv", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: {
        origin: "http://localhost:3001",
        "content-type": "application/json",
        "x-rejsepost-client-ip": "10.9.8.7",
      },
      payload: { email: "nogen@test.dk", password: "forkert-kode" },
    });
    expect(res.statusCode).toBe(429);
  });
});
