import { randomInt } from "node:crypto";

import { Prisma } from "@rejsedagbog/db";
import { INVITE_CODE_LENGTH, inviteJoinInput } from "@rejsedagbog/shared";
import { TRPCError } from "@trpc/server";

import { toTripDto, tripSelect } from "../dto";
import { protectedProcedure, router, tripOwnerProcedure } from "../index";
import { createAttemptLimiter } from "../services/attempt-limiter";

/** Uden 0/O og 1/I, så koden kan læses højt og skrives af uden fejl. Passer stadig til ^[A-Z0-9]{6}$. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/**
 * 10 forsøg pr. bruger pr. 10 minutter. Med 32^6 ≈ 1 mia. mulige koder er gætteri
 * dermed udsigtsløst, og oprettelse af nye konti er selv begrænset (5 pr. minut pr. IP).
 */
export const joinLimiter = createAttemptLimiter({ max: 10, windowMs: 10 * 60_000 });

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

export const invitesRouter = router({
  /** Rejsens invitationskode. Findes der ingen, laves en ny. Kun ejeren. */
  createCode: tripOwnerProcedure.mutation(async ({ ctx, input }) => {
    const trip = await ctx.db.trip.findUniqueOrThrow({
      where: { id: input.tripId },
      select: { inviteCode: true },
    });
    if (trip.inviteCode) return { code: trip.inviteCode };

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        await ctx.db.trip.update({ where: { id: input.tripId }, data: { inviteCode: code } });
        return { code };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err; // koden findes allerede på en anden rejse
      }
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Kunne ikke lave en invitationskode" });
  }),

  /** Fjerner koden, så ingen flere kan tilslutte sig. Eksisterende medlemmer bliver. Kun ejeren. */
  revokeCode: tripOwnerProcedure.mutation(async ({ ctx, input }) => {
    await ctx.db.trip.update({ where: { id: input.tripId }, data: { inviteCode: null } });
    return { ok: true as const };
  }),

  /** Tilslutter brugeren rejsen med koden. Idempotent: er man allerede medlem, returneres rejsen bare. */
  join: protectedProcedure.input(inviteJoinInput).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    if (!joinLimiter.tryAttempt(userId)) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "For mange forsøg. Vent 10 minutter, og prøv igen.",
      });
    }

    const trip = await ctx.db.trip.findUnique({ where: { inviteCode: input.code }, select: { id: true } });
    if (!trip) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Koden passer ikke til nogen rejse" });
    }

    const existing = await ctx.db.tripMember.findUnique({
      where: { tripId_userId: { tripId: trip.id, userId } },
      select: { role: true },
    });
    if (!existing) {
      await ctx.db.tripMember
        .create({ data: { tripId: trip.id, userId, role: "member" } })
        .catch((err) => {
          if (!isUniqueViolation(err)) throw err; // to samtidige forsøg: medlem allerede oprettet
        });
    }

    const full = await ctx.db.trip.findUniqueOrThrow({ where: { id: trip.id }, select: tripSelect });
    return toTripDto(full, existing?.role === "owner" ? "owner" : "member");
  }),
});
