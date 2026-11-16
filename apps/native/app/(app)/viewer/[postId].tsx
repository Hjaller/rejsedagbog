import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { authorLabel, placeLabel } from "@/components/post-views";
import { formatDateTimeLong } from "@/lib/dates";
import { useLocalDb } from "@/lib/local-db/provider";
import { ALL_TRIPS, useActiveTrip, usePost, usePosts } from "@/lib/local-db/queries";
import { postImageSource, type LocalPost } from "@/lib/local-db/repo";
import { space, typo } from "@/lib/theme";

/**
 * Fuldskærmsvisning af rejsens billeder (Must: "tryk for at se et billede i fuld
 * skærm og swipe mellem billederne"). Tryk på billedet skjuler/viser teksterne.
 */
export default function ViewerScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { user } = useLocalDb();
  const start = usePost(postId);
  // Med "Alle rejser" valgt swipes der gennem alle billeder, ligesom i galleriet.
  const { showAll } = useActiveTrip();
  const posts = usePosts(showAll ? ALL_TRIPS : start.data?.tripId);
  const listRef = useRef<FlatList<LocalPost>>(null);
  const [chromeVisible, setChromeVisible] = useState(true);

  // Samme rækkefølge som galleriet: ældste først.
  const photos = useMemo(
    () => (posts.data ?? []).filter((p) => postImageSource(p)).sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    [posts.data],
  );
  // Det viste billede huskes på id, ikke indeks: ved første render er listen endnu ikke
  // hentet (indeks 0), og en synkronisering under visningen kan flytte billederne.
  const [currentId, setCurrentId] = useState(postId);
  const index = Math.max(0, photos.findIndex((p) => p.id === currentId));
  const current = photos[index];

  // Bevar det viste billede, når skærmen roteres (bredden ændrer sig), eller når en
  // synkronisering tilføjer/fjerner billeder før det viste (indekset flytter sig).
  useEffect(() => {
    if (photos.length) listRef.current?.scrollToIndex({ index, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, index]);

  if (start.isLoading || posts.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center" }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" hidden={!chromeVisible} />
      <FlatList
        ref={listRef}
        data={photos}
        keyExtractor={(p) => p.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={index}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={(e) => {
          const shown = photos[Math.round(e.nativeEvent.contentOffset.x / width)];
          if (shown) setCurrentId(shown.id);
        }}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setChromeVisible((v) => !v)}
            style={{ width, height }}
            accessibilityLabel={item.text || placeLabel(item)}
            accessibilityHint="Tryk for at vise eller skjule tekster. Swipe for næste billede."
          >
            <Image
              source={postImageSource(item, "full")!}
              placeholder={postImageSource(item, "thumb") ?? undefined}
              style={{ width, height }}
              contentFit="contain"
              transition={120}
            />
          </Pressable>
        )}
      />

      {chromeVisible ? (
        <>
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              paddingTop: insets.top + space.sm,
              paddingHorizontal: space.lg,
              paddingBottom: space.sm,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: "rgba(0,0,0,0.35)",
            }}
          >
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Luk"
              hitSlop={12}
              style={{ padding: space.xs }}
            >
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
            <Text style={{ color: "#fff", fontSize: 15, fontVariant: ["tabular-nums"] }}>
              {photos.length ? `${index + 1} / ${photos.length}` : ""}
            </Text>
          </View>

          {current ? (
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                paddingHorizontal: space.lg,
                paddingTop: space.md,
                paddingBottom: insets.bottom + space.lg,
                backgroundColor: "rgba(0,0,0,0.45)",
                gap: 2,
              }}
            >
              <Text style={[typo.heading, { color: "#fff" }]}>{placeLabel(current)}</Text>
              <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 13 }}>
                {authorLabel(current, user.id)} · {formatDateTimeLong(current.takenAt)}
              </Text>
              {current.text ? (
                <Text style={[typo.note, { color: "#fff", fontSize: 15, marginTop: space.xs }]} numberOfLines={3}>
                  {current.text}
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
