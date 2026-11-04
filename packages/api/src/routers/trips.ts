import { tripCreateInput, tripUpdateInput } from "@rejsedagbog/shared";
import { TRPCError } from "@trpc/server";

import { toTripDto } from "../dto";
import { protectedProcedure, router, tripMemberProcedure, tripOwnerProcedure } from "../index";

const tripSelect = {
  id: true,
  name: true,
  countryCode: true,
  startDate: true,
  endDate: true,
  inviteCode: true,
  ownerId: true,
  updatedAt: true,
  _count: { select: { members: true } },
} as const;

const asDate = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);

export const tripsRouter = router({
  /** Rejser, brugeren er medlem af, nyeste først. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db.tripMember.findMany({
      where: { userId: ctx.session.user.id },
      select: { role: true, trip: { select: tripSelect } },
      orderBy: { trip: { startDate: "desc" } },
    });
    return memberships.map((m) => toTripDto(m.trip, m.role === "owner" ? "owner" : "member"));
  }),

  get: tripMemberProcedure.query(async ({ ctx, input }) => {
    const trip = await ctx.db.trip.findUniqueOrThrow({
      where: { id: input.tripId },
      select: tripSelect,
    });
    return toTripDto(trip, ctx.membership.role);
  }),

  /** Upsert på appens UUID: et retry efter offline-oprettelse giver ikke en dublet. */
  create: protectedProcedure.input(tripCreateInput).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const existing = await ctx.db.trip.findUnique({ where: { id: input.id }, select: tripSelect });
    if (existing) {
      if (existing.ownerId !== userId) {
        throw new TRPCError({ code: "CONFLICT", message: "Rejse-id'et er allerede i brug" });
      }
      return toTripDto(existing, "owner");
    }
    const trip = await ctx.db.trip.create({
      data: {
        id: input.id,
        name: input.name,
        countryCode: input.countryCode,
        startDate: asDate(input.startDate),
        endDate: asDate(input.endDate),
        ownerId: userId,
        members: { create: { userId, role: "owner" } },
      },
      select: tripSelect,
    });
    return toTripDto(trip, "owner");
  }),

  update: tripOwnerProcedure.input(tripUpdateInput).mutation(async ({ ctx, input }) => {
    const trip = await ctx.db.trip.update({
      where: { id: input.tripId },
      data: {
        name: input.name,
        countryCode: input.countryCode,
        startDate: asDate(input.startDate),
        endDate: asDate(input.endDate),
      },
      select: tripSelect,
    });
    return toTripDto(trip, "owner");
  }),

  delete: tripOwnerProcedure.mutation(async ({ ctx, input }) => {
    const media = await ctx.db.media.findMany({
      where: { tripId: input.tripId },
      select: { key: true, thumbKey: true },
    });
    await ctx.db.trip.delete({ where: { id: input.tripId } });
    if (ctx.storage && media.length) {
      const keys = media.flatMap((m) => (m.thumbKey ? [m.key, m.thumbKey] : [m.key]));
      await ctx.storage.delete(keys).catch((err) => {
        // Rejsen er slettet; forældreløse objekter logges, men vælter ikke kaldet.
        console.error("[trips.delete] kunne ikke slette objekter i bucket:", err);
      });
    }
    return { ok: true as const };
  }),
});
