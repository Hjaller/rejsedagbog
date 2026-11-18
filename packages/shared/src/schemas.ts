import { z } from "zod";

import { INVITE_ACCESS, INVITE_CODE_PATTERN, POST_TEXT_MAX, TRIP_COUNTRIES_MAX, TRIP_NAME_MAX } from "./constants";
import { COUNTRY_NAMES_DA } from "./countries";

/**
 * Datoer krydser API'et som ISO-strenge (tRPC kører uden transformer),
 * så klienten og serveren ser de samme typer.
 */
export const isoDate = z.iso.date(); // "2026-05-12"
export const isoDateTime = z.iso.datetime({ offset: true });

export const countryCode = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/, "Ugyldig landekode")
  .refine((c) => c in COUNTRY_NAMES_DA, "Ukendt land");

/** Rejsens lande i den rækkefølge, de besøges. Dubletter fjernes. */
export const tripCountryCodes = z
  .array(countryCode)
  .min(1, "Vælg mindst ét land")
  .max(TRIP_COUNTRIES_MAX, `Højst ${TRIP_COUNTRIES_MAX} lande`)
  .transform((codes) => [...new Set(codes)]);

const tripFields = {
  name: z.string().trim().min(1, "Rejsen skal have et navn").max(TRIP_NAME_MAX),
  countryCodes: tripCountryCodes.optional(),
  /** Ældre app-versioner sender ét land i stedet for `countryCodes`. */
  countryCode: countryCode.optional(),
  startDate: isoDate,
  endDate: isoDate,
};

const hasCountry = (v: { countryCodes?: string[]; countryCode?: string }) => !!v.countryCodes || !!v.countryCode;
const hasCountryMessage = { message: "Vælg mindst ét land", path: ["countryCodes"] };

/** Samler de to måder at angive land på til én liste. */
function withCountryCodes<T extends { countryCodes?: string[]; countryCode?: string }>(
  v: T,
): Omit<T, "countryCodes" | "countryCode"> & { countryCodes: string[] } {
  const { countryCodes, countryCode: single, ...rest } = v;
  return { ...rest, countryCodes: countryCodes ?? (single ? [single] : []) };
}

const endNotBeforeStart = (v: { startDate: string; endDate: string }) => v.endDate >= v.startDate;
const endNotBeforeStartMessage = {
  message: "Slutdatoen skal være samme dag som eller efter startdatoen",
  path: ["endDate"],
};

/** `id` genereres i appen, så en rejse oprettet offline kan synkroniseres idempotent. */
export const tripCreateInput = z
  .object({ id: z.uuid(), ...tripFields })
  .refine(hasCountry, hasCountryMessage)
  .refine(endNotBeforeStart, endNotBeforeStartMessage)
  .transform(withCountryCodes);
export type TripCreateInput = z.infer<typeof tripCreateInput>;

export const tripUpdateInput = z
  .object({ tripId: z.uuid(), ...tripFields })
  .refine(hasCountry, hasCountryMessage)
  .refine(endNotBeforeStart, endNotBeforeStartMessage)
  .transform(withCountryCodes);
export type TripUpdateInput = z.infer<typeof tripUpdateInput>;

export const tripIdInput = z.object({ tripId: z.uuid() });

export const postText = z.string().trim().max(POST_TEXT_MAX, `Højst ${POST_TEXT_MAX} tegn`);

export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);

/** `id` genereres i appen → `posts.create` er en upsert, så retries aldrig giver dubletter. */
export const postCreateInput = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  text: postText,
  takenAt: isoDateTime,
  lat: latitude.nullish(),
  lon: longitude.nullish(),
  mediaId: z.uuid().nullish(),
});
export type PostCreateInput = z.infer<typeof postCreateInput>;

/**
 * `lat`/`lon` er valgfrie: med dem flyttes indlægget dertil (fx et billede fra albummet
 * uden position), og sted og vejr findes på ny. Uden dem rettes kun teksten.
 */
export const postUpdateInput = z
  .object({
    tripId: z.uuid(),
    postId: z.uuid(),
    text: postText,
    lat: latitude.nullish(),
    lon: longitude.nullish(),
  })
  .refine((v) => (v.lat == null) === (v.lon == null), "Både bredde- og længdegrad skal angives");
export type PostUpdateInput = z.infer<typeof postUpdateInput>;

export const postRefInput = z.object({ tripId: z.uuid(), postId: z.uuid() });

export const postListInput = z.object({
  tripId: z.uuid(),
  /** Hent kun indlæg ændret efter dette tidspunkt (inkl. slettede, så klienten kan fjerne dem). */
  since: isoDateTime.optional(),
});

export const inviteCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(INVITE_CODE_PATTERN, "Koden består af 6 bogstaver og tal");

export const inviteJoinInput = z.object({ code: inviteCode });

/** `access` vælger koden: "member" (kan lægge op, standard) eller "viewer" (kan kun se). */
export const inviteCodeInput = z.object({ tripId: z.uuid(), access: z.enum(INVITE_ACCESS).default("member") });

export const enrichPreviewInput = z.object({
  lat: latitude,
  lon: longitude,
  takenAt: isoDateTime,
});

/** Søgning efter et sted at sætte på et indlæg. `countryCodes` foretrækker rejsens lande. */
export const placeSearchInput = z.object({
  query: z.string().trim().min(2, "Skriv mindst 2 tegn").max(120, "Højst 120 tegn"),
  countryCodes: z
    .array(z.string().regex(/^[A-Za-z]{2}$/))
    .max(TRIP_COUNTRIES_MAX)
    .nullish(),
  /** Ældre app-versioner sender ét land. */
  countryCode: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .nullish(),
});
export type PlaceSearchInput = z.infer<typeof placeSearchInput>;

export type PlaceSearchResult = {
  /** Kort navn, fx "Colosseum". */
  name: string;
  /** Resten af adressen, fx "Rom, Italien". */
  detail: string | null;
  lat: number;
  lon: number;
};

export const signInInput = z.object({
  email: z.email("Indtast en gyldig e-mailadresse").trim(),
  password: z.string().min(8, "Adgangskoden skal være mindst 8 tegn"),
});

export const signUpInput = signInInput.extend({
  name: z.string().trim().min(2, "Navnet skal være mindst 2 tegn"),
});
