import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { PostDetail, PostListItem } from "@/components/post-views";
import { TripHeader, useTripLabel } from "@/components/trip-header";
import { TripMap } from "@/components/trip-map";
import { useBreakpoint } from "@/lib/breakpoints";
import { useLocalDb } from "@/lib/local-db/provider";
import { useSelectedPosts } from "@/lib/local-db/queries";
import { hasPosition, viewForPosts } from "@/lib/map-view";
import { radius, space, usePalette } from "@/lib/theme";

/** Kortvisning (Should 5): rejsens indlæg med GPS-position som miniaturer på et OpenStreetMap-kort. */
export default function MapScreen() {
  const p = usePalette();
  const router = useRouter();
  const bp = useBreakpoint();
  const { user } = useLocalDb();
  const { trip, trips, showAll, scope, posts, pendingCount, isLoading } = useSelectedPosts();
  const tripLabel = useTripLabel(trips, showAll);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const all = useMemo(() => posts.data ?? [], [posts.data]);
  const positioned = useMemo(() => all.filter(hasPosition), [all]);
  const view = useMemo(() => viewForPosts(positioned), [positioned]);
  const withoutPosition = all.length - positioned.length;
  const selected = positioned.find((x) => x.id === selectedId) ?? null;

  const header = (
    <TripHeader
      eyebrow="KORT"
      trip={trip}
      allTrips={showAll ? trips : null}
      pendingCount={pendingCount}
      right={
        positioned.length > 0 ? (
          <Text style={{ color: p.textMuted, fontSize: 15, fontVariant: ["tabular-nums"] }}>
            {positioned.length} {positioned.length === 1 ? "sted" : "steder"}
          </Text>
        ) : null
      }
    />
  );

  let body;
  if (isLoading || (scope && posts.isLoading)) {
    body = <ActivityIndicator style={{ marginTop: space.xxl }} />;
  } else if (!scope) {
    body = (
      <EmptyState icon="map-outline" title="Ingen rejse valgt">
        <Button label="Ny rejse" icon="add" onPress={() => router.push("/trip/new")} />
      </EmptyState>
    );
  } else if (!view) {
    body = (
      <EmptyState
        icon="map-outline"
        title="Intet at vise på kortet endnu"
        message={
          all.length > 0
            ? `Ingen af ${showAll ? "dine rejsers" : "rejsens"} indlæg har en position. Tillad placering, når du opretter et indlæg, så kommer det på kortet.`
            : "Indlæg med GPS-position bliver vist her."
        }
      >
        <Button label="Nyt indlæg" icon="add" onPress={() => router.push("/post/new")} />
      </EmptyState>
    );
  } else {
    body = (
      <View style={{ flex: 1 }}>
        {/* Ny rejse = nyt kort, så startudsnittet passer til rejsens (eller alle rejsers) indlæg. */}
        <TripMap key={scope} posts={positioned} view={view} selectedId={selectedId} onSelect={setSelectedId} />
        {withoutPosition > 0 && !(selected && bp !== "expanded") ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: space.lg,
              bottom: space.lg + 16,
              paddingHorizontal: space.md,
              paddingVertical: space.xs,
              borderRadius: radius.pill,
              backgroundColor: p.surface,
              opacity: 0.92,
            }}
          >
            <Text style={{ color: p.textMuted, fontSize: 12 }}>
              {withoutPosition} indlæg uden position vises ikke
            </Text>
          </View>
        ) : null}
        {selected && bp !== "expanded" ? (
          <View
            style={{
              position: "absolute",
              left: space.md,
              right: space.md,
              bottom: space.md + 16,
              borderRadius: radius.lg,
              borderCurve: "continuous",
              overflow: "hidden",
              borderWidth: 1,
              borderColor: p.border,
              boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
              maxWidth: 560,
              alignSelf: "center",
            }}
          >
            <PostListItem
              post={selected}
              currentUserId={user.id}
              selected={false}
              tripLabel={tripLabel(selected)}
              onPress={() => router.push(`/post/${selected.id}`)}
            />
            <Pressable
              onPress={() => setSelectedId(null)}
              accessibilityRole="button"
              accessibilityLabel="Luk"
              hitSlop={8}
              style={{ position: "absolute", top: space.xs, right: space.xs, padding: space.xs }}
            >
              <Ionicons name="close" size={20} color={p.textMuted} />
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ flex: 1 }}>
        {header}
        {body}
      </View>
      {bp === "expanded" && view ? (
        <View style={{ width: 420, borderLeftWidth: 1, borderLeftColor: p.border, backgroundColor: p.background }}>
          {selected ? (
            <ScrollView contentContainerStyle={{ padding: space.xl }} contentInsetAdjustmentBehavior="automatic">
              <PostDetail
                post={selected}
                currentUserId={user.id}
                onImagePress={() => router.push(`/viewer/${selected.id}`)}
                onDeleted={() => setSelectedId(null)}
              />
            </ScrollView>
          ) : (
            <EmptyState icon="location-outline" title="Vælg et sted" message="Tryk på et billede på kortet for at se indlægget." />
          )}
        </View>
      ) : null}
    </View>
  );
}
