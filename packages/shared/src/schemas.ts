import { z } from "zod";

import { INVITE_CODE_PATTERN, POST_TEXT_MAX, TRIP_NAME_MAX } from "./constants";
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

const tripFields = {
  name: z.string().trim().min(1, "Rejsen skal have et navn").max(TRIP_NAME_MAX),
  countryCode,
  startDate: isoDate,
  endDate: isoDate,
};

const endNotBeforeStart = (v: { startDate: string; endDate: string }) => v.endDate >= v.startDate;
const endNotBeforeStartMessage = {
  message: "Slutdatoen skal være samme dag som eller efter startdatoen",
  path: ["endDate"],
};

/** `id` genereres i appen, så en rejse oprettet offline kan synkroniseres idempotent. */
export const tripCreateInput = z
  .object({ id: z.uuid(), ...tripFields })
  .refine(endNotBeforeStart, endNotBeforeStartMessage);
export type TripCreateInput = z.infer<typeof tripCreateInput>;

export const tripUpdateInput = z
  .object({ tripId: z.uuid(), ...tripFields })
  .refine(endNotBeforeStart, endNotBeforeStartMessage);
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

export const postUpdateInput = z.object({
  tripId: z.uuid(),
  postId: z.uuid(),
  text: postText,
});
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

export const enrichPreviewInput = z.object({
  lat: latitude,
  lon: longitude,
  takenAt: isoDateTime,
});

export const signInInput = z.object({
  email: z.email("Indtast en gyldig e-mailadresse").trim(),
  password: z.string().min(8, "Adgangskoden skal være mindst 8 tegn"),
});

export const signUpInput = signInInput.extend({
  name: z.string().trim().min(2, "Navnet skal være mindst 2 tegn"),
});
