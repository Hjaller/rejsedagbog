import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseTrustProxy } from "../src/trust-proxy";
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

describe("rate limiting bag en reverse proxy", () => {
  const PROXY = "10.0.0.2";
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestApp({ trustProxy: PROXY });
  });

  afterAll(() => t.close());

  const attempt = (forwardedFor: string, remoteAddress = PROXY) =>
    t.app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      remoteAddress,
      headers: {
        origin: "http://localhost:3001",
        "content-type": "application/json",
        "x-forwarded-for": forwardedFor,
      },
      payload: { email: "nogen@test.dk", password: "forkert-kode" },
    });

  const statusesOf = async (send: (i: number) => ReturnType<typeof attempt>) => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await send(i)).statusCode);
    return statuses;
  };
  const LIMITED = [401, 401, 401, 401, 401, 429];

  it("klienten kan ikke omgå grænsen med en falsk X-Forwarded-For", async () => {
    // Klienten bestemmer alt til venstre; proxyen tilføjer den rigtige IP til sidst.
    expect(await statusesOf((i) => attempt(`192.0.2.${i}, 203.0.113.5`))).toEqual(LIMITED);
  });

  it("en anden klient bag samme proxy har sin egen grænse", async () => {
    expect((await attempt("203.0.113.6")).statusCode).toBe(401);
  });

  it("en direkte forbindelse uden om proxyen kan heller ikke forfalske sin IP", async () => {
    expect(await statusesOf((i) => attempt(`192.0.2.${i}`, "198.51.100.9"))).toEqual(LIMITED);
  });
});

describe("parseTrustProxy", () => {
  it("er slået fra, når intet er sat", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy(" ")).toBe(false);
  });

  it("forstår IP og CIDR, også flere", () => {
    expect(parseTrustProxy("10.0.0.2")).toBe("10.0.0.2");
    expect(parseTrustProxy("172.16.0.0/12, ::1")).toBe("172.16.0.0/12,::1");
  });

  it.each(["true", "false", "1", "0", "0.0.0.0/0", "::/0", "10.0.0.2/33", "10.0.0.2/8/8", "proxy.lan"])(
    "stopper opstarten ved %s",
    (value) => {
      expect(() => parseTrustProxy(value)).toThrow(/TRUST_PROXY/);
    },
  );
});
