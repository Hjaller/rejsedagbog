import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertSecureServerUrl } from "../../native/lib/server-url";
import { createTestApp, type TestContext } from "./helpers";

describe("appen taler kun HTTPS med serveren uden for udvikling", () => {
  it("tillader https:// i alle builds", () => {
    expect(assertSecureServerUrl("https://api.example.com", false)).toBe("https://api.example.com");
    expect(assertSecureServerUrl("https://api.example.com", true)).toBe("https://api.example.com");
  });

  it("tillader kun http:// under udvikling", () => {
    expect(assertSecureServerUrl("http://192.168.1.20:3000", true)).toBe("http://192.168.1.20:3000");
    expect(() => assertSecureServerUrl("http://192.168.1.20:3000", false)).toThrow(/https/);
    expect(() => assertSecureServerUrl("http://api.example.com", false)).toThrow(/https/);
  });

  it("afviser andre protokoller", () => {
    expect(() => assertSecureServerUrl("ftp://api.example.com", true)).toThrow();
  });
});

describe("HSTS", () => {
  let t: TestContext;
  beforeAll(async () => {
    // Som i drift: serveren står bag en proxy, der afslutter TLS.
    t = await createTestApp({ trustProxy: "127.0.0.1" });
  });
  afterAll(() => t.close());

  it("sætter Strict-Transport-Security, når forespørgslen kom over HTTPS", async () => {
    const res = await t.app.inject({ method: "GET", url: "/", headers: { "x-forwarded-proto": "https" } });
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("sætter den ikke over HTTP (lokal udvikling)", async () => {
    const res = await t.app.inject({ method: "GET", url: "/" });
    expect(res.headers["strict-transport-security"]).toBeUndefined();
  });

  it("en klient kan ikke selv udløse den uden om proxyen", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/",
      remoteAddress: "203.0.113.9",
      headers: { "x-forwarded-proto": "https" },
    });
    expect(res.headers["strict-transport-security"]).toBeUndefined();
  });
});
