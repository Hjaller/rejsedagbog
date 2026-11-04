import type { Weather } from "@rejsedagbog/shared";

/**
 * Berigelse af indlæg med stednavn (Nominatim/OpenStreetMap) og vejr (Open-Meteo).
 * Kaldene går gennem serveren, fordi Nominatims brugspolitik kræver en
 * identificerende User-Agent og højst 1 forespørgsel pr. sekund.
 */

const USER_AGENT = "Rejsepost/0.1 (rejsedagbog studieprojekt)";
const FETCH_TIMEOUT_MS = 8_000;

export type Enrichment = {
  placeName: string | null;
  countryCode: string | null;
  weather: Weather | null;
};

// ---------------------------------------------------------------------------
// Små hjælpere: cache med udløb og en kø, der overholder Nominatims 1 req/s.
// ---------------------------------------------------------------------------

class TtlCache<V> {
  private map = new Map<string, { value: V; expires: number }>();
  constructor(
    private ttlMs: number,
    private maxEntries = 2_000,
  ) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V) {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}

let nominatimQueue: Promise<unknown> = Promise.resolve();
let lastNominatimCall = 0;

function throttledNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimQueue.then(async () => {
    const wait = lastNominatimCall + 1_100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimCall = Date.now();
    return fn();
  });
  nominatimQueue = run.catch(() => undefined);
  return run;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "da,en" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fra ${new URL(url).host}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Sted
// ---------------------------------------------------------------------------

type NominatimResponse = {
  name?: string;
  address?: Record<string, string | undefined>;
  error?: string;
};

// Afrund til ~100 m, så nærliggende billeder deler cache.
const placeCache = new TtlCache<{ placeName: string | null; countryCode: string | null }>(
  7 * 24 * 3600_000,
);

export async function reverseGeocode(lat: number, lon: number) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = placeCache.get(key);
  if (cached) return cached;

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lon),
    zoom: "16",
    addressdetails: "1",
  }).toString();

  const data = (await throttledNominatim(() => fetchJson(url.toString()))) as NominatimResponse;
  const result = { placeName: formatPlaceName(data), countryCode: countryCodeOf(data) };
  placeCache.set(key, result);
  return result;
}

function formatPlaceName(data: NominatimResponse): string | null {
  if (data.error) return null;
  const a = data.address ?? {};
  const spot =
    data.name ||
    a.tourism ||
    a.attraction ||
    a.amenity ||
    a.neighbourhood ||
    a.suburb ||
    a.quarter ||
    a.road;
  const town = a.city || a.town || a.village || a.municipality || a.county;
  const parts = [spot, town].filter((p, i, arr): p is string => !!p && arr.indexOf(p) === i);
  return parts.length ? parts.join(", ") : (a.country ?? null);
}

function countryCodeOf(data: NominatimResponse): string | null {
  const cc = data.address?.country_code;
  return cc && /^[a-z]{2}$/i.test(cc) ? cc.toUpperCase() : null;
}

// ---------------------------------------------------------------------------
// Vejr
// ---------------------------------------------------------------------------

type OpenMeteoHourly = {
  hourly?: {
    time: string[];
    temperature_2m: (number | null)[];
    weather_code: (number | null)[];
    wind_speed_10m: (number | null)[];
  };
};

const weatherCache = new TtlCache<Weather | null>(3 * 3600_000);

/**
 * Vejret i den time, billedet blev taget. Virker også, når indlægget synkroniseres
 * dage senere: forecast-API'et dækker ~3 måneder tilbage, ældre datoer hentes fra arkivet.
 */
export async function weatherAt(lat: number, lon: number, takenAt: Date): Promise<Weather | null> {
  const date = takenAt.toISOString().slice(0, 10);
  const hour = takenAt.getUTCHours();
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${date}T${hour}`;
  const cached = weatherCache.get(key);
  if (cached !== undefined) return cached;

  const ageDays = (Date.now() - takenAt.getTime()) / 86_400_000;
  const host =
    ageDays > 85 ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
  const url = new URL(host);
  url.search = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: "temperature_2m,weather_code,wind_speed_10m",
    timezone: "UTC",
    start_date: date,
    end_date: date,
  }).toString();

  const data = (await fetchJson(url.toString())) as OpenMeteoHourly;
  const h = data.hourly;
  const i = h?.time.findIndex((t) => t.startsWith(`${date}T${String(hour).padStart(2, "0")}`)) ?? -1;
  const tempC = i >= 0 ? h?.temperature_2m[i] : null;
  const code = i >= 0 ? h?.weather_code[i] : null;
  const wind = i >= 0 ? h?.wind_speed_10m[i] : null;
  const weather =
    tempC != null && code != null ? { tempC, code, windKmh: wind ?? 0 } : null;
  weatherCache.set(key, weather);
  return weather;
}

// ---------------------------------------------------------------------------

/** Henter sted og vejr parallelt. Fejl i én kilde giver null i stedet for at vælte kaldet. */
export async function enrich(lat: number, lon: number, takenAt: Date): Promise<Enrichment> {
  const [place, weather] = await Promise.allSettled([
    reverseGeocode(lat, lon),
    weatherAt(lat, lon, takenAt),
  ]);
  if (place.status === "rejected") console.warn("[enrich] stednavn fejlede:", place.reason);
  if (weather.status === "rejected") console.warn("[enrich] vejr fejlede:", weather.reason);
  return {
    placeName: place.status === "fulfilled" ? place.value.placeName : null,
    countryCode: place.status === "fulfilled" ? place.value.countryCode : null,
    weather: weather.status === "fulfilled" ? weather.value : null,
  };
}
