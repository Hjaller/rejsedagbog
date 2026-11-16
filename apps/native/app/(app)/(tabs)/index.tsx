import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, View } from "react-native";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { PostCard, PostDetail, PostListItem } from "@/components/post-views";
import { DayHeading, TripHeader, useTripLabel } from "@/components/trip-header";
import { useBreakpoint } from "@/lib/breakpoints";
import { dayHeading, toIsoDate } from "@/lib/dates";
import { useLocalDb } from "@/lib/local-db/provider";
import { useSelectedPosts } from "@/lib/local-db/queries";
import type { LocalPost, LocalTrip } from "@/lib/local-db/repo";
import { useRefreshSync } from "@/lib/sync/sync-scheduler";
import { space, usePalette } from "@/lib/theme";

type Row =
  | { type: "day"; key: string; title: string; subtitle?: string }
  | { type: "post"; key: string; post: LocalPost };

/** Indlæggene (nyeste først) delt op i rejsedage: "Dag 5 · tirsdag 14. april". */
function buildRows(posts: LocalPost[], trips: LocalTrip[]): Row[] {
  const tripsById = new Map(trips.map((t) => [t.id, t]));
  const rows: Row[] = [];
  let current = "";
  for (const post of posts) {
    const date = new Date(post.takenAt);
    const key = `${post.tripId}-${toIsoDate(date)}`;
    if (key !== current) {
      current = key;
      rows.push({ type: "day", key: `d-${key}`, ...dayHeading(date, tripsById.get(post.tripId)) });
    }
    rows.push({ type: "post", key: post.id, post });
  }
  return rows;
}

export default function TimelineScreen() {
  const p = usePalette();
  const router = useRouter();
  const bp = useBreakpoint();
  const { user } = useLocalDb();
  const { trip, trips, showAll, scope, posts, pendingCount, isLoading: tripLoading } = useSelectedPosts();
  const tripLabel = useTripLabel(trips, showAll);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const refresh = useRefreshSync();
  const list = posts.data ?? [];
  const rows = useMemo(() => buildRows(list, trips), [list, trips]);

  const header = (
    <TripHeader eyebrow="REJSEPOST" trip={trip} allTrips={showAll ? trips : null} pendingCount={pendingCount} />
  );

  if (tripLoading || (scope && posts.isLoading)) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <ActivityIndicator style={{ marginTop: space.xxl }} />
      </View>
    );
  }

  if (!scope) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <EmptyState
          icon="airplane-outline"
          title="Opret din første rejse"
          message="En rejse samler indlæg, billeder, sted og vejr. Du kan oprette den uden internet."
        >
          <Button label="Ny rejse" icon="add" onPress={() => router.push("/trip/new")} />
        </EmptyState>
      </View>
    );
  }

  if (posts.error) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <EmptyState icon="alert-circle-outline" title="Kunne ikke læse indlæggene" message="Prøv at genstarte appen.">
          <Button label="Prøv igen" variant="secondary" onPress={() => posts.refetch()} />
        </EmptyState>
      </View>
    );
  }

  if (list.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <EmptyState
          icon="camera-outline"
          title="Ingen indlæg endnu"
          message={
            showAll
              ? "Ingen af dine rejser har indlæg endnu. Tryk på + og tag et billede – sted, vejr og land kommer på af sig selv."
              : "Tryk på + og tag et billede – sted, vejr og land kommer på af sig selv."
          }
        >
          <Button label="Tilføj det første billede" icon="add" variant="accent" onPress={() => router.push("/post/add")} />
        </EmptyState>
      </View>
    );
  }

  // Stor skærm: liste til venstre, valgt indlæg stort til højre (wireframe 2).
  if (bp === "expanded") {
    const selected = list.find((x) => x.id === selectedId) ?? list[0]!;
    return (
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ width: 380, borderRightWidth: 1, borderRightColor: p.border, backgroundColor: p.surface }}>
          {header}
          <FlatList
            {...refresh}
            data={rows}
            keyExtractor={(r) => r.key}
            renderItem={({ item }) =>
              item.type === "day" ? (
                <View style={{ paddingHorizontal: space.lg, backgroundColor: p.surface }}>
                  <DayHeading title={item.title} subtitle={item.subtitle} />
                </View>
              ) : (
                <PostListItem
                  post={item.post}
                  currentUserId={user.id}
                  selected={item.post.id === selected.id}
                  tripLabel={tripLabel(item.post)}
                  onPress={() => setSelectedId(item.post.id)}
                />
              )
            }
          />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.xxl, maxWidth: 820, width: "100%", alignSelf: "center" }}
          contentInsetAdjustmentBehavior="automatic"
        >
          <PostDetail
            post={selected}
            currentUserId={user.id}
            onImagePress={() => router.push(`/viewer/${selected.id}`)}
            onDeleted={() => setSelectedId(null)}
          />
        </ScrollView>
      </View>
    );
  }

  // Mobil og tablet: én kolonne med postkort, delt op i dage.
  return (
    <View style={{ flex: 1 }}>
      {header}
      <FlatList
        {...refresh}
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingBottom: space.xxl,
          gap: space.md,
          maxWidth: 640,
          width: "100%",
          alignSelf: "center",
        }}
        renderItem={({ item }) =>
          item.type === "day" ? (
            <DayHeading title={item.title} subtitle={item.subtitle} />
          ) : (
            <PostCard
              post={item.post}
              currentUserId={user.id}
              tripLabel={tripLabel(item.post)}
              onPress={() => router.push(`/post/${item.post.id}`)}
            />
          )
        }
      />
    </View>
  );
}
