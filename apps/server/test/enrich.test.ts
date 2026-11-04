import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Køen til Nominatim må ikke kunne få posts.create til at hænge. Eksterne kald er mocket. */
describe("berigelse: begrænset kø og deadline", () => {
  let nominatimCalls = 0;
  const TAKEN_AT = new Date("2026-05-14T10:00:00Z");

  const json = (body: unknown) => ({ ok: true, json: async () => body });

  const stubFetch = (nominatim: () => unknown) => {
    vi.stubGlobal("fetch", (url: string) => {
      if (!url.includes("nominatim")) return Promise.resolve(json({}));
      nominatimCalls++;
      return nominatim();
    });
  };
  const place = () => Promise.resolve(json({ name: "Sted", address: { country_code: "it" } }));

  /** Køen ligger i modulet, så hver test får sin egen. */
  const loadEnrich = async () => (await import("@rejsedagbog/api/services/enrich")).enrich;

  /** Forskellige koordinater, så cachen ikke rammes. */
  const lat = (i: number) => 10 + i * 0.01;

  beforeEach(() => {
    nominatimCalls = 0;
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("én bruger kan højst fylde sin egen del af køen, og andre kommer stadig til", async () => {
    stubFetch(place);
    const enrich = await loadEnrich();

    const flood = [0, 1, 2, 3, 4].map((i) => enrich(lat(i), 12, TAKEN_AT, "angriber"));
    const other = enrich(lat(10), 12, TAKEN_AT, "sara");

    await vi.advanceTimersByTimeAsync(5_000);
    const places = (await Promise.all(flood)).map((r) => r.placeName);
    expect(places).toEqual(["Sted", "Sted", "Sted", null, null]);
    expect((await other).placeName).toBe("Sted");
    expect(nominatimCalls).toBe(4);
  });

  it("når hele køen er fuld, svarer nye kald med det samme uden stednavn", async () => {
    stubFetch(place);
    const enrich = await loadEnrich();

    const settled = new Set<number>();
    const calls = Array.from({ length: 25 }, (_, i) =>
      enrich(lat(i), 12, TAKEN_AT, `bruger-${i}`).then((r) => {
        settled.add(i);
        return r;
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    for (const i of [20, 21, 22, 23, 24]) expect(settled.has(i)).toBe(true);
    expect((await calls[24]!).placeName).toBeNull();

    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all(calls);
    expect(nominatimCalls).toBe(20);
  });

  it("en kilde, der hænger, stopper ikke kaldet efter deadline", async () => {
    stubFetch(() => new Promise(() => {}));
    const enrich = await loadEnrich();

    let done = false;
    const call = enrich(lat(0), 12, TAKEN_AT, "sara").then((r) => {
      done = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(11_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(done).toBe(true);
    expect((await call).placeName).toBeNull();
  });
});
