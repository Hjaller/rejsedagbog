import { enrichPreviewInput } from "@rejsedagbog/shared";

import { protectedProcedure, router } from "../index";
import { getCountryFacts } from "../services/countries";
import { enrich } from "../services/enrich";

export const enrichRouter = router({
  /** Forhåndsvisning af sted og vejr på opret-skærmen, når der er net. */
  // Mutation, så koordinaterne ligger i body og ikke i URL'en (og dermed i adgangslogs).
  preview: protectedProcedure.input(enrichPreviewInput).mutation(({ ctx, input }) =>
    enrich(input.lat, input.lon, new Date(input.takenAt), ctx.session.user.id),
  ),

  /** Valuta, sprog og hovedstad for alle lande. Appen cacher svaret i SQLite. */
  countries: protectedProcedure.query(({ ctx }) => getCountryFacts(ctx.restCountriesApiKey)),
});
