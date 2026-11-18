import { tripIdInput } from "@rejsedagbog/shared";
import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";

import type { Context } from "./context";
import { assertTripMember, canContribute } from "./trip-access";

export const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    // Fejlbeskeder uden tekniske detaljer (kravspec afsnit 4). Detaljer logges kun på serveren.
    if (error.code === "INTERNAL_SERVER_ERROR") {
      return {
        ...shape,
        message: "Der skete en fejl på serveren. Prøv igen senere.",
        data: { ...shape.data, stack: undefined },
      };
    }
    // Valideringsfejl: vis den første, læsbare besked i stedet for rå Zod-JSON.
    if (error.cause instanceof ZodError) {
      const issue = error.cause.issues[0];
      return {
        ...shape,
        message: issue?.message ?? "Ugyldigt input",
        data: { ...shape.data, stack: undefined, field: issue?.path.join(".") ?? null },
      };
    }
    return { ...shape, data: { ...shape.data, stack: undefined } };
  },
});

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Du skal være logget ind",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

/**
 * Fælles adgangs-middleware: alle procedurer, der rører en rejses data, SKAL bygge
 * på denne. Den læser `tripId` fra input og afviser brugere, der ikke er medlem
 * (kravspec, sikkerhedsrisiko 1 og risikoanalysen).
 */
export const tripMemberProcedure = protectedProcedure
  .input(tripIdInput)
  .use(async ({ ctx, input, next }) => {
    const membership = await assertTripMember(ctx.db, ctx.session.user.id, input.tripId);
    return next({ ctx: { ...ctx, membership } });
  });

/**
 * Som tripMemberProcedure, men ikke for dem, der kun har fået rejsen delt til visning.
 * Alt, der opretter eller ændrer indlæg, SKAL bygge på denne.
 */
export const tripContributorProcedure = tripMemberProcedure.use(({ ctx, next }) => {
  if (!canContribute(ctx.membership.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Rejsen er delt med dig, så du kan se den, men ikke lægge noget op",
    });
  }
  return next();
});

/** Som tripMemberProcedure, men kun for rejsens ejer. */
export const tripOwnerProcedure = tripMemberProcedure.use(({ ctx, next }) => {
  if (ctx.membership.role !== "owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Kun rejsens ejer kan gøre dette" });
  }
  return next();
});
