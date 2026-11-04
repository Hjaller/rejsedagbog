import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { PostDetail } from "@/components/post-views";
import { TripHeader } from "@/components/trip-header";
import { galleryColumns, useBreakpoint } from "@/lib/breakpoints";
import { formatDayHeading } from "@/lib/dates";
import { useLocalDb } from "@/lib/local-db/provider";
import { useActiveTrip, usePendingCount, usePosts } from "@/lib/local-db/queries";
import { useRefreshSync } from "@/lib/sync/sync-scheduler";
import { postImageSource, postImageUri, type LocalPost } from "@/lib/local-db/repo";
import { space, usePalette } from "@/lib/theme";

type Row = { type: "day"; key: string; title: string } | { type: "row"; key: string; posts: LocalPost[] };

const GAP = 3;

/** Grupperer billeder pr. dag (wireframe 4) og deler dem op i rækker til et virtualiseret gitter. */
function buildRows(posts: LocalPost[], columns: number): Row[] {
  const byDay = new Map<string, LocalPost[]>();
  for (const post of posts) {
    if (!postImageUri(post, "thumb")) continue;
    const d = new Date(post.takenAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const list = byDay.get(key) ?? [];
    list.push(post);
    byDay.set(key, list);
  }
  const rows: Row[] = [];
  // Ældste dag først i galleriet, ligesom en fotobog.
  for (const [key, list] of [...byDay.entries()].reverse()) {
    const ordered = [...list].reverse();
    rows.push({ type: "day", key: `d-${key}`, title: formatDayHeading(new Date(ordered[0]!.takenAt)) });
    for (let i = 0; i < ordered.length; i += columns) {
      rows.push({ type: "row", key: `r-${key}-${i}`, posts: ordered.slice(i, i + columns) });
    }
  }
  return rows;
}

export default function GalleryScreen() {
  const p = usePalette();
  const router = useRouter();
  const bp = useBreakpoint();
  const { user } = useLocalDb();
  const { trip, isLoading } = useActiveTrip();
  const posts = usePosts(trip?.id);
  const pending = usePendingCount(trip?.id);
  const [width, setWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const refresh = useRefreshSync();

  const columns = galleryColumns(bp, width);
  const rows = useMemo(() => buildRows(posts.data ?? [], columns), [posts.data, columns]);
  const photoCount = rows.reduce((n, r) => n + (r.type === "row" ? r.posts.length : 0), 0);
  const cell = width > 0 ? (width - space.lg * 2 - GAP * (columns - 1)) / columns : 0;

  const header = (
    <TripHeader
      eyebrow="GALLERI"
      trip={trip}
      pendingCount={pending.data ?? 0}
      right={
        <Text style={{ color: p.textMuted, fontSize: 15, fontVariant: ["tabular-nums"] }}>
          {photoCount} {photoCount === 1 ? "billede" : "billeder"}
        </Text>
      }
    />
  );

  const open = (post: LocalPost) => {
    if (bp === "expanded") setSelectedId(post.id);
    else router.push(`/viewer/${post.id}`);
  };

  let body;
  if (isLoading || posts.isLoading) {
    body = <ActivityIndicator style={{ marginTop: space.xxl }} />;
  } else if (!trip) {
    body = (
      <EmptyState icon="images-outline" title="Ingen rejse valgt">
        <Button label="Ny rejse" icon="add" onPress={() => router.push("/trip/new")} />
      </EmptyState>
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState icon="images-outline" title="Ingen billeder endnu" message="Billederne fra rejsens indlæg samles her.">
        <Button label="Nyt indlæg" icon="add" onPress={() => router.push("/post/new")} />
      </EmptyState>
    );
  } else {
    body = (
      <FlatList
        {...refresh}
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 100 }}
        renderItem={({ item }) =>
          item.type === "day" ? (
            <Text style={{ color: p.text, fontSize: 15, fontWeight: "600", paddingTop: space.lg, paddingBottom: space.sm }}>
              {item.title}
            </Text>
          ) : (
            <View style={{ flexDirection: "row", gap: GAP, marginBottom: GAP }}>
              {item.posts.map((post) => (
                <GalleryCell key={post.id} post={post} size={cell} selected={post.id === selectedId} onPress={() => open(post)} />
              ))}
            </View>
          )
        }
      />
    );
  }

  const selected = (posts.data ?? []).find((x) => x.id === selectedId);

  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ flex: 1 }}>
        {header}
        <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 ? body : null}
        </View>
      </View>
      {bp === "expanded" ? (
        <View style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: p.border }}>
          {selected ? (
            <ScrollView contentContainerStyle={{ padding: space.xl }} contentInsetAdjustmentBehavior="automatic">
              <PostDetail
                post={selected}
                currentUserId={user.id}
                onImagePress={() => router.push(`/viewer/${selected.id}`)}
              />
            </ScrollView>
          ) : (
            <EmptyState icon="image-outline" title="Vælg et billede" message="Billedet vises her i stort format." />
          )}
        </View>
      ) : null}
    </View>
  );
}

function GalleryCell({
  post,
  size,
  selected,
  onPress,
}: {
  post: LocalPost;
  size: number;
  selected: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const pending = post.syncStatus !== "synkroniseret";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={post.text || post.placeName || "Billede"}
      style={({ pressed }) => ({ width: size, height: size, opacity: pressed ? 0.8 : 1 })}
    >
      <Image
        source={postImageSource(post, "thumb")!}
        style={{ width: size, height: size, backgroundColor: p.placeholder }}
        contentFit="cover"
        recyclingKey={post.id}
      />
      {pending || selected ? (
        <View
          style={{
            position: "absolute",
            inset: 0,
            borderWidth: selected ? 3 : 1,
            borderStyle: selected ? "solid" : "dashed",
            borderColor: selected ? p.accent : p.surface,
            backgroundColor: pending ? "rgba(0,0,0,0.35)" : "transparent",
            alignItems: "center",
            justifyContent: "center",
            padding: 4,
          }}
        >
          {pending ? (
            <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600", textAlign: "center" }}>Venter på upload</Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
