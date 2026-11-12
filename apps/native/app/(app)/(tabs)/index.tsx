import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, View } from "react-native";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { PostCard, PostDetail, PostListItem } from "@/components/post-views";
import { TripHeader } from "@/components/trip-header";
import { useBreakpoint } from "@/lib/breakpoints";
import { useLocalDb } from "@/lib/local-db/provider";
import { useActiveTrip, usePendingCount, usePosts } from "@/lib/local-db/queries";
import { useRefreshSync } from "@/lib/sync/sync-scheduler";
import { space, usePalette } from "@/lib/theme";

export default function TimelineScreen() {
  const p = usePalette();
  const router = useRouter();
  const bp = useBreakpoint();
  const { user } = useLocalDb();
  const { trip, isLoading: tripLoading } = useActiveTrip();
  const posts = usePosts(trip?.id);
  const pending = usePendingCount(trip?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const refresh = useRefreshSync();

  const header = <TripHeader eyebrow="REJSEPOST" trip={trip} pendingCount={pending.data ?? 0} />;

  if (tripLoading || (trip && posts.isLoading)) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <ActivityIndicator style={{ marginTop: space.xxl }} />
      </View>
    );
  }

  if (!trip) {
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

  const list = posts.data ?? [];

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
          message="Tag et billede – sted, vejr og land bliver tilføjet automatisk."
        >
          <Button label="Nyt indlæg" icon="add" onPress={() => router.push("/post/new")} />
        </EmptyState>
      </View>
    );
  }

  // Stor skærm: liste til venstre, valgt indlæg stort til højre (wireframe 2).
  if (bp === "expanded") {
    const selected = list.find((x) => x.id === selectedId) ?? list[0]!;
    return (
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ width: 360, borderRightWidth: 1, borderRightColor: p.border, backgroundColor: p.surface }}>
          {header}
          <FlatList
            {...refresh}
            data={list}
            keyExtractor={(x) => x.id}
            renderItem={({ item }) => (
              <PostListItem
                post={item}
                currentUserId={user.id}
                selected={item.id === selected.id}
                onPress={() => setSelectedId(item.id)}
              />
            )}
          />
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.xl, maxWidth: 900, width: "100%", alignSelf: "center" }}
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

  // Mobil og tablet: én kolonne med kort.
  return (
    <View style={{ flex: 1 }}>
      {header}
      <FlatList
        {...refresh}
        data={list}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{
          padding: space.lg,
          gap: space.lg,
          paddingBottom: 100, // plads til "+"-knappen
          maxWidth: 640,
          width: "100%",
          alignSelf: "center",
        }}
        renderItem={({ item }) => (
          <PostCard post={item} currentUserId={user.id} onPress={() => router.push(`/post/${item.id}`)} />
        )}
      />
    </View>
  );
}
