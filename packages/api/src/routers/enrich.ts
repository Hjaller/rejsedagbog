import { enrichPreviewInput, placeSearchInput } from "@rejsedagbog/shared";
import { TRPCError } from "@trpc/server";

import { protectedProcedure, router } from "../index";
import { getCountryFacts } from "../services/countries";
import { enrich, searchPlaces } from "../services/enrich";

export const enrichRouter = router({
  /** Forhåndsvisning af sted og vejr på opret-skærmen, når der er net. */
  // Mutation, så koordinaterne ligger i body og ikke i URL'en (og dermed i adgangslogs).
  preview: protectedProcedure.input(enrichPreviewInput).mutation(({ ctx, input }) =>
    enrich(input.lat, input.lon, new Date(input.takenAt), ctx.session.user.id),
  ),

  /** Søg efter et sted at sætte på et indlæg. Mutation af samme grund som preview. */
  searchPlaces: protectedProcedure.input(placeSearchInput).mutation(async ({ ctx, input }) => {
    try {
      const countries = input.countryCodes?.length ? input.countryCodes : input.countryCode ? [input.countryCode] : [];
      return await searchPlaces(input.query, countries, ctx.session.user.id);
    } catch (err) {
      console.warn("[enrich.searchPlaces] fejlede:", err);
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Søgningen virker ikke lige nu. Prøv igen om lidt, eller flyt kortet selv.",
      });
    }
  }),

  /** Valuta, sprog og hovedstad for alle lande. Appen cacher svaret i SQLite. */
  countries: protectedProcedure.query(({ ctx }) => getCountryFacts(ctx.restCountriesApiKey)),
});
