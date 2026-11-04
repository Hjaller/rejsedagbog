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
  replaceCountryFacts,
  setMeta,
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

/** Den aktive rejse (valgt i Rejser-fanen og forvalgt på opret-skærmen). */
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
  const trip = list.find((t) => t.id === activeId.data) ?? defaultTrip(list) ?? null;

  const setActiveTrip = async (tripId: string) => {
    await setMeta(db, "activeTripId", tripId);
    queryClient.setQueryData(keys.activeTripId(user.id), tripId);
  };

  return {
    trip,
    trips: list,
    isLoading: trips.isLoading || activeId.isLoading,
    error: trips.error ?? activeId.error,
    setActiveTrip,
  };
}

export function usePosts(tripId: string | undefined) {
  const { db, user } = useLocalDb();
  return useQuery({
    ...localQuery,
    queryKey: keys.posts(user.id, tripId ?? ""),
    queryFn: () => listPosts(db, tripId!),
    enabled: !!tripId,
  });
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
