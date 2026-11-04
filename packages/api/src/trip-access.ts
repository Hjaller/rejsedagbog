import type { Database } from "@rejsedagbog/db";
import { TRPCError } from "@trpc/server";

export type TripMembership = { tripId: string; userId: string; role: "owner" | "member" };

/** Slår medlemskab op. Returnerer null, hvis brugeren ikke er medlem (eller rejsen ikke findes). */
export async function getTripMembership(
  db: Database,
  userId: string,
  tripId: string,
): Promise<TripMembership | null> {
  const member = await db.tripMember.findUnique({
    where: { tripId_userId: { tripId, userId } },
    select: { tripId: true, userId: true, role: true },
  });
  if (!member) return null;
  return { ...member, role: member.role === "owner" ? "owner" : "member" };
}

/**
 * Kaster NOT_FOUND, hvis brugeren ikke er medlem af rejsen. Vi skelner bevidst ikke
 * mellem "findes ikke" og "ingen adgang", så fremmede ikke kan gætte rejse-id'er.
 * Bruges af tripMemberProcedure og af upload-routen i Fastify.
 */
export async function assertTripMember(
  db: Database,
  userId: string,
  tripId: string,
): Promise<TripMembership> {
  const membership = await getTripMembership(db, userId, tripId);
  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Rejsen findes ikke" });
  }
  return membership;
}
