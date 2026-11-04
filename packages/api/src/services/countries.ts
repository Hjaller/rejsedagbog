import type { CountryFacts } from "@rejsedagbog/shared";

/**
 * Landefakta fra REST Countries v5 (https://restcountries.com/docs/countries).
 * v3.1 er lukket; v5 kræver en API-nøgle, som derfor kun ligger på serveren.
 * Hele listen (~250 lande) hentes i sider à 100 og caches i et døgn.
 */

const BASE_URL = "https://api.restcountries.com/countries/v5";
const PAGE_SIZE = 100; // max på gratisplanen
const TTL_MS = 24 * 3600_000;

type V5Country = {
  codes?: { alpha_2?: string };
  currencies?: { code?: string }[];
  languages?: { iso639_1?: string | null; name?: string }[];
  capitals?: { name?: string }[];
};

type V5Page = { data?: { objects?: V5Country[] }; errors?: { message: string }[] };

let cache: { at: number; facts: CountryFacts[] } | null = null;
let inflight: Promise<CountryFacts[]> | null = null;

const languageNamesDa = new Intl.DisplayNames(["da"], { type: "language", fallback: "none" });

function languageDa(l: { iso639_1?: string | null; name?: string }): string | null {
  const viaIntl = l.iso639_1 ? languageNamesDa.of(l.iso639_1) : undefined;
  return viaIntl ?? l.name?.toLowerCase() ?? null;
}

function toFacts(c: V5Country): CountryFacts | null {
  const code = c.codes?.alpha_2?.toUpperCase();
  if (!code) return null;
  return {
    code,
    currencies: (c.currencies ?? []).flatMap((x) => (x.code ? [x.code] : [])),
    languages: (c.languages ?? []).flatMap((l) => {
      const name = languageDa(l);
      return name ? [name] : [];
    }),
    capital: c.capitals?.[0]?.name ?? null,
  };
}

async function fetchAll(apiKey: string): Promise<CountryFacts[]> {
  const facts: CountryFacts[] = [];
  for (let offset = 0; offset < 1000; offset += PAGE_SIZE) {
    const url = new URL(BASE_URL);
    url.search = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      response_fields: "codes.alpha_2,currencies.code,languages.iso639_1,languages.name,capitals.name",
    }).toString();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as V5Page;
    if (!res.ok) {
      throw new Error(`REST Countries ${res.status}: ${body.errors?.[0]?.message ?? "ukendt fejl"}`);
    }
    const objects = body.data?.objects ?? [];
    for (const o of objects) {
      const f = toFacts(o);
      if (f) facts.push(f);
    }
    if (objects.length < PAGE_SIZE) break;
  }
  return facts;
}

/** Returnerer [] uden API-nøgle eller ved fejl; appen viser så kun navn og flag. */
export async function getCountryFacts(apiKey: string | null): Promise<CountryFacts[]> {
  if (!apiKey) return [];
  if (cache && Date.now() - cache.at < TTL_MS) return cache.facts;
  inflight ??= fetchAll(apiKey)
    .then((facts) => {
      cache = { at: Date.now(), facts };
      return facts;
    })
    .catch((err) => {
      console.warn("[countries] REST Countries fejlede:", err);
      return cache?.facts ?? [];
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
