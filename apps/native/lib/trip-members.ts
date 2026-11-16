import { useQuery } from "@tanstack/react-query";

import { apiErrorMessage } from "@/lib/api-errors";
import { useLocalDb } from "@/lib/local-db/provider";
import { useInvalidateLocal } from "@/lib/local-db/queries";
import { getMeta, setMeta, setTripMemberCount, type LocalTrip } from "@/lib/local-db/repo";
import { trpcClient } from "@/utils/trpc";

export type TripMember = Awaited<ReturnType<typeof trpcClient.trips.members.query>>[number];

export type TripMembersResult = {
  members: TripMember[];
  /** Hvornår listen sidst blev hentet fra serveren. null = rejsen findes kun på telefonen. */
  fetchedAt: string | null;
  /** Sat, når listen er den gemte, fordi serveren ikke kunne nås. */
  offlineMessage: string | null;
};

const OFFLINE = "Ingen forbindelse. Viser gruppen, som den så ud sidst.";
const cacheKey = (tripId: string) => `members:${tripId}`;
const TIMEOUT_MS = 8000;

/**
 * Hvem der er med på rejsen. Hentes fra serveren og gemmes i SQLite, så listen
 * også kan vises offline (som resten af appen). Antal i gruppen rettes samtidig.
 */
export function useTripMembers(trip: LocalTrip | undefined) {
  const { db, user } = useLocalDb();
  const invalidateLocal = useInvalidateLocal();

  return useQuery({
    queryKey: ["remote", user.id, "members", trip?.id, trip?.syncStatus],
    enabled: !!trip,
    networkMode: "always",
    retry: false,
    queryFn: async (): Promise<TripMembersResult> => {
      const t = trip!;
      // En rejse, der ikke er uploadet, kan kun have én deltager: dig.
      if (t.syncStatus !== "synkroniseret") {
        const self: TripMember = { id: user.id, name: user.name, role: "owner", joinedAt: t.createdAt };
        return { members: [self], fetchedAt: null, offlineMessage: null };
      }
      // Uden timeout kan kaldet hænge længe på et dårligt net, og så vises den gemte liste aldrig.
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
      try {
        const members = await trpcClient.trips.members.query({ tripId: t.id }, { signal: abort.signal });
        const fetchedAt = new Date().toISOString();
        await setMeta(db, cacheKey(t.id), JSON.stringify({ members, fetchedAt }));
        if (await setTripMemberCount(db, t.id, members.length)) await invalidateLocal();
        return { members, fetchedAt, offlineMessage: null };
      } catch (err) {
        const cached = await getMeta(db, cacheKey(t.id));
        const message = abort.signal.aborted ? OFFLINE : apiErrorMessage(err, OFFLINE);
        // Kun manglende net falder tilbage til den gemte liste; andre fejl vises.
        if (cached && message === OFFLINE) {
          const parsed = JSON.parse(cached) as { members: TripMember[]; fetchedAt: string };
          return { ...parsed, offlineMessage: OFFLINE };
        }
        throw new Error(message === OFFLINE ? "Ingen forbindelse. Gruppen kan ses, når du har internet." : message);
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
