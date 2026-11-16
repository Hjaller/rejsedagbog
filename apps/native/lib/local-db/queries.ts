import type { CountryFacts } from "@rejsedagbog/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { toIsoDate } from "@/lib/dates";
import { requestSync } from "@/lib/sync/sync-scheduler";

import { useLocalDb } from "./provider";
import {
  countPending,
  countPostsByTrip,
  getCountryFacts,
  getMeta,
  getPost,
  insertPost,
  insertTrip,
  listPosts,
  listTrips,
  markPostDeleted,
  replaceCountryFacts,
  setMeta,
  setTripInviteCode,
  updatePostPosition,
  updatePostText,
  type LocalTrip,
  type NewLocalPost,
} from "./repo";

/**
 * React Query over den lokale SQLite-database. Alle nøgler starter med
 * ["local", userId], så én invalidering opdaterer alle skærme efter en skrivning.
 */
const keys = {
  all: (userId: string) => ["local", userId] as const,
  trips: (userId: string) => ["local", userId, "trips"] as const,
  activeTripId: (userId: string) => ["local", userId, "activeTripId"] as const,
  posts: (userId: string, tripId: string) => ["local", userId, "posts", tripId] as const,
  post: (userId: string, postId: string) => ["local", userId, "post", postId] as const,
  pending: (userId: string, tripId?: string) => ["local", userId, "pending", tripId ?? "all"] as const,
  postCounts: (userId: string) => ["local", userId, "postCounts"] as const,
  country: (userId: string, code: string) => ["local", userId, "country", code] as const,
};

// Lokale data ændres kun af appen selv, så de er "friske", indtil vi invaliderer.
const localQuery = { staleTime: Infinity, networkMode: "always" } as const;

export function useInvalidateLocal() {
  const queryClient = useQueryClient();
  const { user } = useLocalDb();
  return () => queryClient.invalidateQueries({ queryKey: keys.all(user.id) });
}

export function useTrips() {
  const { db, user } = useLocalDb();
  return useQuery({ ...localQuery, queryKey: keys.trips(user.id), queryFn: () => listTrips(db) });
}

export function usePostCounts() {
  const { db, user } = useLocalDb();
  return useQuery({
    ...localQuery,
    queryKey: keys.postCounts(user.id),
    queryFn: () => countPostsByTrip(db),
  });
}

/** Rejsen, der er i gang i dag, ellers den nyeste. */
function defaultTrip(trips: LocalTrip[]): LocalTrip | undefined {
  const today = toIsoDate(new Date());
  return trips.find((t) => t.startDate <= today && today <= t.endDate) ?? trips[0];
}

/**
 * Valget "Alle rejser" i Rejser-fanen. Gemmes i stedet for et rejse-id; rejsernes
 * id'er er UUID'er, så det kan ikke forveksles med en rigtig rejse.
 */
export const ALL_TRIPS = "alle";

/**
 * Den aktive rejse (valgt i Rejser-fanen og forvalgt på opret-skærmen).
 * Med "Alle rejser" valgt er `trip` null og `showAll` true; `defaultTrip` er så den
 * rejse, nye indlæg forvælges til.
 */
export function useActiveTrip() {
  const { db, user } = useLocalDb();
  const queryClient = useQueryClient();
  const trips = useTrips();
  const activeId = useQuery({
    ...localQuery,
    queryKey: keys.activeTripId(user.id),
    queryFn: () => getMeta(db, "activeTripId"),
  });

  const list = trips.data ?? [];
  const fallback = defaultTrip(list) ?? null;
  // "Alle rejser" giver kun mening, når der er rejser at vise.
  const showAll = activeId.data === ALL_TRIPS && list.length > 0;
  const trip = showAll ? null : (list.find((t) => t.id === activeId.data) ?? fallback);

  const setActiveTrip = async (tripId: string) => {
    await setMeta(db, "activeTripId", tripId);
    queryClient.setQueryData(keys.activeTripId(user.id), tripId);
  };

  return {
    trip,
    showAll,
    /** Den valgte rejse, eller (med "Alle rejser") den, der er i gang / den nyeste. */
    defaultTrip: trip ?? fallback,
    trips: list,
    isLoading: trips.isLoading || activeId.isLoading,
    error: trips.error ?? activeId.error,
    setActiveTrip,
  };
}

/** Indlæg på én rejse, eller på alle rejser med `ALL_TRIPS`. Henter intet, når `tripId` mangler. */
export function usePosts(tripId: string | undefined) {
  const { db, user } = useLocalDb();
  return useQuery({
    ...localQuery,
    queryKey: keys.posts(user.id, tripId ?? ""),
    queryFn: () => listPosts(db, tripId === ALL_TRIPS ? null : tripId!),
    enabled: !!tripId,
  });
}

/**
 * Det, tidslinje, galleri og kort viser: den aktive rejse eller alle rejser,
 * med indlæg og antallet, der venter på upload, for samme udvalg.
 */
export function useSelectedPosts() {
  const active = useActiveTrip();
  const scope = active.showAll ? ALL_TRIPS : active.trip?.id;
  const posts = usePosts(scope);
  const pending = usePendingCount(active.showAll ? undefined : active.trip?.id);
  return { ...active, scope, posts, pendingCount: pending.data ?? 0 };
}

export function usePost(postId: string | undefined) {
  const { db, user } = useLocalDb();
  return useQuery({
    ...localQuery,
    queryKey: keys.post(user.id, postId ?? ""),
    queryFn: () => getPost(db, postId!),
    enabled: !!postId,
  });
}

export function usePendingCount(tripId?: string) {
  const { db, user } = useLocalDb();
  return useQuery({
    ...localQuery,
    queryKey: keys.pending(user.id, tripId),
    queryFn: () => countPending(db, tripId),
  });
}

export function useCountryFacts(code: string | null | undefined) {
  const { db, user } = useLocalDb();
  return useQuery({
    ...localQuery,
    queryKey: keys.country(user.id, code ?? ""),
    queryFn: () => getCountryFacts(db, code!),
    enabled: !!code,
  });
}

export function useCreateTrip() {
  const { db } = useLocalDb();
  const invalidate = useInvalidateLocal();
  const { setActiveTrip } = useActiveTrip();
  return useMutation({
    networkMode: "always",
    mutationFn: async (trip: Parameters<typeof insertTrip>[1]) => {
      await insertTrip(db, trip);
      await setActiveTrip(trip.id);
    },
    onSuccess: () => {
      void invalidate();
      // Upload med det samme, hvis der er net; ellers ligger det i køen.
      void requestSync();
    },
  });
}

export function useCreatePost() {
  const { db } = useLocalDb();
  const invalidate = useInvalidateLocal();
  return useMutation({
    networkMode: "always",
    mutationFn: (post: NewLocalPost) => insertPost(db, post),
    onSuccess: () => {
      void invalidate();
      // Upload med det samme, hvis der er net; ellers ligger det i køen.
      void requestSync();
    },
  });
}

/** Retter teksten på et eget indlæg. Gemmes lokalt og sendes af upload-køen (virker offline). */
export function useUpdatePostText() {
  const { db } = useLocalDb();
  const invalidate = useInvalidateLocal();
  return useMutation({
    networkMode: "always",
    mutationFn: ({ postId, text }: { postId: string; text: string }) => updatePostText(db, postId, text),
    onSuccess: () => {
      void invalidate();
      void requestSync();
    },
  });
}

/**
 * Sætter positionen på et eller flere egne indlæg (samme sted til alle). Gemmes lokalt og
 * sendes af upload-køen, så det virker offline; sted og vejr findes af serveren.
 */
export function useSetPostPosition() {
  const { db } = useLocalDb();
  const invalidate = useInvalidateLocal();
  return useMutation({
    networkMode: "always",
    mutationFn: async ({ postIds, coords }: { postIds: string[]; coords: { lat: number; lon: number } }) => {
      for (const id of postIds) await updatePostPosition(db, id, coords);
    },
    onSuccess: () => {
      void invalidate();
      void requestSync();
    },
  });
}

/** Sletter et eget indlæg lokalt med det samme; upload-køen sletter det på serveren. */
export function useDeletePost() {
  const { db } = useLocalDb();
  const invalidate = useInvalidateLocal();
  return useMutation({
    networkMode: "always",
    mutationFn: (postId: string) => markPostDeleted(db, postId),
    onSuccess: () => {
      void invalidate();
      void requestSync();
    },
  });
}

/** Gemmer invitationskoden lokalt, efter serveren har lavet eller fjernet den. */
export function useSetTripInviteCode() {
  const { db } = useLocalDb();
  const invalidate = useInvalidateLocal();
  return async (tripId: string, code: string | null) => {
    await setTripInviteCode(db, tripId, code);
    await invalidate();
  };
}

/** Henter landefakta fra serveren og cacher dem i SQLite (højst én gang om ugen). */
export function useRefreshCountryFactsOnStart(fetchFacts: () => Promise<CountryFacts[]>) {
  const { db } = useLocalDb();
  const invalidate = useInvalidateLocal();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fetchedAt = await getMeta(db, "countriesFetchedAt");
      if (fetchedAt && Date.now() - Date.parse(fetchedAt) < 7 * 86_400_000) return;
      try {
        const facts = await fetchFacts();
        if (cancelled || !facts.length) return;
        await replaceCountryFacts(db, facts);
        invalidate();
      } catch {
        // Offline eller server nede: prøv igen ved næste opstart. Navn og flag virker uden.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Kør kun ved opstart for den aktuelle database.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);
}
