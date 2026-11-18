import { randomInt } from "node:crypto";

import { Prisma } from "@rejsedagbog/db";
import { INVITE_CODE_LENGTH, inviteCodeInput, inviteJoinInput, type InviteAccess } from "@rejsedagbog/shared";
import { TRPCError } from "@trpc/server";

import { toTripDto, tripSelect } from "../dto";
import { protectedProcedure, router, tripOwnerProcedure } from "../index";
import { createAttemptLimiter, ipRateLimitKey } from "../services/attempt-limiter";
import { toTripRole } from "../trip-access";

/** Uden 0/O og 1/I, så koden kan læses højt og skrives af uden fejl. Passer stadig til ^[A-Z0-9]{6}$. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/**
 * To grænser, fordi én konto er billig: oprettelse er kun begrænset til 5 pr. minut
 * pr. IP, så én IP kan lave ~7.000 konti i døgnet. Alene ville grænsen pr. bruger
 * give ~10 mio. gæt i døgnet mod 32^6 ≈ 1 mia. koder.
 *  - pr. bruger: 10 forsøg pr. 10 minutter (alle forsøg)
 *  - pr. IP: 20 forkerte koder pr. 10 minutter (kun fejl, så mange på samme wifi
 *    kan tilslutte sig samme rejse). Højst ~2.900 gæt i døgnet pr. IP.
 * Bag en proxy kræver IP-grænsen, at TRUST_PROXY er sat (ellers deler alle én IP).
 */
export const joinLimiter = createAttemptLimiter({ max: 10, windowMs: 10 * 60_000 });
export const joinFailuresByIp = createAttemptLimiter({ max: 20, windowMs: 10 * 60_000 });

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Kolonnen på rejsen for hver slags kode. */
const codeColumn = { member: "inviteCode", viewer: "viewCode" } as const satisfies Record<InviteAccess, string>;

/** Vilkårligt, men fast tal: låsen, der gør "er koden ledig?" + "gem koden" til ét skridt. */
const CODE_LOCK_ID = 7_265_301;

export const invitesRouter = router({
  /**
   * Rejsens kode: invitationskoden (`access: "member"`, kan lægge op) eller koden til
   * deling (`access: "viewer"`, kan kun se). Findes der ingen, laves en ny. Kun ejeren.
   */
  createCode: tripOwnerProcedure.input(inviteCodeInput).mutation(async ({ ctx, input }) => {
    const column = codeColumn[input.access];
    const trip = await ctx.db.trip.findUniqueOrThrow({
      where: { id: input.tripId },
      select: { inviteCode: true, viewCode: true },
    });
    if (trip[column]) return { code: trip[column] };

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      // De to slags koder deler navnerum: en kode må kun passe til én rejse og én slags
      // adgang, ellers kunne en visningskode give lov til at lægge op. Databasen sikrer kun
      // hver kolonne for sig, så tjek og skrivning sker under en lås.
      const saved = await ctx.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CODE_LOCK_ID})`;
        const taken = await tx.trip.findFirst({
          where: { OR: [{ inviteCode: code }, { viewCode: code }] },
          select: { id: true },
        });
        if (taken) return false;
        await tx.trip.update({ where: { id: input.tripId }, data: { [column]: code } });
        return true;
      });
      if (saved) return { code };
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Kunne ikke lave en kode" });
  }),

  /**
   * Fjerner koden, så ingen flere kan bruge den. Dem, der allerede har adgang, beholder
   * den. Kun ejeren.
   */
  revokeCode: tripOwnerProcedure.input(inviteCodeInput).mutation(async ({ ctx, input }) => {
    await ctx.db.trip.update({ where: { id: input.tripId }, data: { [codeColumn[input.access]]: null } });
    return { ok: true as const };
  }),

  /**
   * Giver brugeren adgang til rejsen med koden: som medlem med invitationskoden, eller
   * kun til at se med koden til deling. Idempotent: har man allerede adgang, returneres
   * rejsen bare. En, der kun kan se, bliver medlem med invitationskoden; ingen mister
   * adgang ved at bruge en visningskode.
   */
  join: protectedProcedure.input(inviteJoinInput).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const ipKey = ipRateLimitKey(ctx.clientIp ?? "ukendt");
    const tooMany = () =>
      new TRPCError({ code: "TOO_MANY_REQUESTS", message: "For mange forsøg. Vent 10 minutter, og prøv igen." });

    // Begge pladser reserveres synkront før databaseopslaget, så samtidige forsøg
    // ikke alle kan nå forbi tjekket, før den første fejl er talt.
    const now = Date.now();
    if (!joinLimiter.tryAttempt(userId, now)) throw tooMany();
    if (!joinFailuresByIp.tryAttempt(ipKey, now)) {
      joinLimiter.refund(userId, now);
      throw tooMany();
    }

    const trip = await ctx.db.trip.findFirst({
      where: { OR: [{ inviteCode: input.code }, { viewCode: input.code }] },
      select: { id: true, inviteCode: true },
    });
    if (!trip) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Koden passer ikke til nogen rejse" });
    }
    // Kun forkerte koder tæller pr. IP, så mange på samme wifi kan tilslutte sig.
    joinFailuresByIp.refund(ipKey, now);

    const granted: InviteAccess = trip.inviteCode === input.code ? "member" : "viewer";
    const where = { tripId_userId: { tripId: trip.id, userId } };
    const existing = await ctx.db.tripMember.findUnique({ where, select: { role: true } });
    if (!existing) {
      await ctx.db.tripMember.create({ data: { tripId: trip.id, userId, role: granted } }).catch((err) => {
        if (!isUniqueViolation(err)) throw err; // to samtidige forsøg: adgangen er allerede oprettet
      });
    }
    // Fra "kan kun se" til medlem. updateMany, så ejer og medlem aldrig kan blive sat ned.
    if (granted === "member") {
      await ctx.db.tripMember.updateMany({
        where: { tripId: trip.id, userId, role: "viewer" },
        data: { role: "member" },
      });
    }

    const [full, membership] = await Promise.all([
      ctx.db.trip.findUniqueOrThrow({ where: { id: trip.id }, select: tripSelect }),
      ctx.db.tripMember.findUniqueOrThrow({ where, select: { role: true } }),
    ]);
    return toTripDto(full, toTripRole(membership.role));
  }),
});
