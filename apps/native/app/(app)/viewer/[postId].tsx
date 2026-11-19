import Ionicons from "@expo/vector-icons/Ionicons";
import { useEvent, useEventListener } from "expo";
import { Image } from "expo-image";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { authorLabel, placeLabel } from "@/components/post-views";
import { formatDateTimeLong } from "@/lib/dates";
import { useLocalDb } from "@/lib/local-db/provider";
import { ALL_TRIPS, useActiveTrip, usePost, usePosts } from "@/lib/local-db/queries";
import { isVideo, postImageSource, postVideoUri, type LocalPost } from "@/lib/local-db/repo";
import { MIN_TOUCH, scaledLines, space, typo } from "@/lib/theme";

/** Så længe vises et billede i diasshowet. En video vises, til den er spillet færdig. */
const SLIDE_MS = 4_000;

/**
 * Fuldskærmsvisning af rejsens billeder og videoer (Must: "tryk for at se et billede i
 * fuld skærm og swipe mellem billederne"). Tryk skjuler/viser teksterne. Videoer spiller,
 * når de vises. Diasshow (Could) viser billederne efter hinanden og starter forfra.
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
  const [slideshow, setSlideshow] = useState(false);

  // Samme rækkefølge som galleriet: ældste først.
  const items = useMemo(
    () =>
      (posts.data ?? [])
        .filter((p) => postImageSource(p) || postVideoUri(p))
        .sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    [posts.data],
  );
  // Det viste billede huskes på id, ikke indeks: ved første render er listen endnu ikke
  // hentet (indeks 0), og en synkronisering under visningen kan flytte billederne.
  const [currentId, setCurrentId] = useState(postId);
  const index = Math.max(0, items.findIndex((p) => p.id === currentId));
  const current = items[index];

  // Indekset, listen står på. Når det ikke passer (skærmen er roteret, eller en synkronisering
  // har flyttet billederne), springes der uden animation. Diasshowet animerer selv.
  const scrolledTo = useRef<{ index: number; width: number } | null>(null);
  useEffect(() => {
    if (!items.length) return;
    const at = scrolledTo.current;
    if (at && at.index === index && at.width === width) return;
    scrolledTo.current = { index, width };
    listRef.current?.scrollToIndex({ index, animated: false });
  }, [width, index, items.length]);

  const goTo = useCallback(
    (next: number) => {
      const item = items[next];
      if (!item) return;
      scrolledTo.current = { index: next, width };
      // Kun nabosider animeres: et langt spring (fra sidste til første) ville vise tomme,
      // endnu ikke tegnede sider (windowSize) som et sort glimt.
      listRef.current?.scrollToIndex({ index: next, animated: Math.abs(next - index) === 1 });
      setCurrentId(item.id);
    },
    [items, width, index],
  );

  /** Næste i diasshowet; efter det sidste startes forfra. */
  const advance = useCallback(() => goTo(items.length ? (index + 1) % items.length : 0), [goTo, index, items.length]);

  // Billeder skifter efter SLIDE_MS. Videoer skifter, når de er spillet færdig (VideoPage).
  useEffect(() => {
    if (!slideshow || !current || isVideo(current) || items.length < 2) return;
    const timer = setTimeout(advance, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [slideshow, current, advance, items.length]);

  const startSlideshow = () => {
    setSlideshow(true);
    setChromeVisible(false);
  };
  const stopSlideshow = () => {
    setSlideshow(false);
    setChromeVisible(true);
  };
  const onTap = () => (slideshow ? stopSlideshow() : setChromeVisible((v) => !v));

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
      {slideshow ? <KeepAwake /> : null}
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(p) => p.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={index}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          const shown = items[i];
          if (!shown) return;
          scrolledTo.current = { index: i, width };
          setCurrentId(shown.id);
        }}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        renderItem={({ item }) =>
          isVideo(item) ? (
            <VideoPage
              post={item}
              active={item.id === current?.id}
              slideshow={slideshow && items.length > 1}
              width={width}
              height={height}
              controlsVisible={chromeVisible}
              onTap={onTap}
              onEnded={advance}
            />
          ) : (
            <Pressable
              onPress={onTap}
              style={{ width, height }}
              accessibilityLabel={item.text || placeLabel(item)}
              accessibilityHint="Tryk for at vise eller skjule tekster. Swipe for næste billede."
            >
              <Image
                source={postImageSource(item, "full")!}
                placeholder={postImageSource(item, "thumb") ?? undefined}
                style={{ width, height }}
                contentFit="contain"
                transition={slideshow ? 400 : 120}
              />
            </Pressable>
          )
        }
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
              gap: space.md,
              backgroundColor: "rgba(0,0,0,0.35)",
            }}
          >
            <TopButton icon="close" label="Luk" onPress={() => router.back()} />
            <Text style={{ flex: 1, color: "#fff", fontSize: 15, fontVariant: ["tabular-nums"], textAlign: "center" }}>
              {items.length ? `${index + 1} / ${items.length}` : ""}
            </Text>
            {items.length > 1 ? (
              <TopButton icon="play" label="Start diasshow" onPress={startSlideshow} />
            ) : (
              <View style={{ width: 36 }} />
            )}
          </View>

          {current ? (
            <View
              pointerEvents="box-none"
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
                <Text style={[typo.note, { color: "#fff", fontSize: 15, marginTop: space.xs }]} numberOfLines={scaledLines(3)}>
                  {current.text}
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      ) : slideshow ? (
        // En diskret stop-knap, så man kan se, at diasshowet kører, og hvordan det stoppes.
        <View style={{ position: "absolute", top: insets.top + space.sm, right: space.lg }}>
          <TopButton icon="pause" label="Stop diasshow" onPress={stopSlideshow} dim />
        </View>
      ) : null}
    </View>
  );
}

function KeepAwake() {
  // Skærmen må ikke slukke midt i et diasshow.
  useKeepAwake();
  return null;
}

function TopButton({
  icon,
  label,
  onPress,
  dim,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  dim?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Den synlige cirkel er 36; trykfeltet er 48.
      style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: "center", justifyContent: "center" }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: dim ? "rgba(0,0,0,0.35)" : "transparent",
          opacity: dim ? 0.8 : 1,
        }}
      >
        <Ionicons name={icon} size={dim ? 20 : 26} color="#fff" />
      </View>
    </Pressable>
  );
}

/**
 * En video i fuldskærm. Den spiller, når den vises, og stopper og spoles tilbage, når
 * man swiper videre. I et diasshow gentages den ikke, men går videre, når den er færdig.
 */
function VideoPage({
  post,
  active,
  slideshow,
  width,
  height,
  controlsVisible,
  onTap,
  onEnded,
}: {
  post: LocalPost;
  active: boolean;
  slideshow: boolean;
  width: number;
  height: number;
  controlsVisible: boolean;
  onTap: () => void;
  onEnded: () => void;
}) {
  // Den første URL beholdes: synkroniseringen henter nye signerede links, og en ny URL
  // ville give en ny afspiller, så videoen startede forfra midt i visningen.
  const [uri] = useState(() => postVideoUri(post));
  const poster = postImageSource(post, "full");
  const player = useVideoPlayer(uri ? { uri } : null, (p) => {
    p.loop = true;
  });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const { status } = useEvent(player, "statusChange", { status: player.status });

  useEffect(() => {
    if (active) {
      player.play();
    } else {
      player.pause();
      player.currentTime = 0;
    }
  }, [active, player]);

  useEffect(() => {
    player.loop = !slideshow;
  }, [slideshow, player]);

  useEventListener(player, "playToEnd", () => {
    if (active && slideshow) onEnded();
  });

  // Kan videoen ikke hentes (fx udløbet link uden net), må diasshowet ikke gå i stå.
  useEffect(() => {
    if (!active || !slideshow || status !== "error") return;
    const timer = setTimeout(onEnded, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [active, slideshow, status, onEnded]);

  const ready = status === "readyToPlay";
  return (
    <View style={{ width, height }}>
      <VideoView player={player} style={{ width, height }} contentFit="contain" nativeControls={false} />
      {/* Plakatrammen dækker, indtil videoen kan vises (og hvis den ikke kan hentes). */}
      {!ready && poster ? (
        <Image
          source={poster}
          style={{ position: "absolute", inset: 0 }}
          contentFit="contain"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <Pressable
        onPress={onTap}
        style={{ position: "absolute", inset: 0 }}
        accessibilityLabel={`Video. ${post.text || placeLabel(post)}`}
        accessibilityHint="Tryk for at vise eller skjule tekster. Swipe for næste."
      />
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", gap: space.sm }}
      >
        {status === "error" ? (
          <Text style={{ color: "#fff", fontSize: 15, textAlign: "center", paddingHorizontal: space.xl }}>
            Videoen kan ikke afspilles lige nu. Træk ned i tidslinjen for at hente den igen.
          </Text>
        ) : status === "loading" && active ? (
          <ActivityIndicator color="#fff" />
        ) : controlsVisible || (!isPlaying && active) ? (
          <Pressable
            onPress={() => (isPlaying ? player.pause() : player.play())}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? "Pause" : "Afspil"}
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: "rgba(0,0,0,0.45)",
              borderWidth: 2,
              borderColor: "rgba(255,255,255,0.9)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name={isPlaying ? "pause" : "play"} size={30} color="#fff" style={{ marginLeft: isPlaying ? 0 : 3 }} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
