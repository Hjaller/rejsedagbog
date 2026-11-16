import Ionicons from "@expo/vector-icons/Ionicons";
import { POST_TEXT_MAX, postText, weatherLabel } from "@rejsedagbog/shared";
import { useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { useNetworkState } from "expo-network";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { TextField } from "@/components/text-field";
import { formatTime, tripDay } from "@/lib/dates";
import { useLocalDb } from "@/lib/local-db/provider";
import { useActiveTrip, useCreatePost, useDeletePost, useUpdatePostText } from "@/lib/local-db/queries";
import { getMeta, getPost, setMeta } from "@/lib/local-db/repo";
import {
  CAPTURE_MAX_AGE_MS,
  getCurrentCoords,
  getLocationPermission,
  persistPhoto,
  pickPhotos,
  requestLocationPermission,
  SCREEN_OPEN_MAX_AGE_MS,
  takePhoto,
  takeRecoveredPhoto,
  type Coords,
  type LocationPermission,
  type PickedPhoto,
} from "@/lib/media";
import { radius, space, typo, usePalette } from "@/lib/theme";
import { trpcClient } from "@/utils/trpc";

/** Så længe ventes der højst på positionen fra da billedet blev taget, før indlægget gemmes. */
const CAPTURE_WAIT_MS = 5_000;
/** Har kameraet været åbent længere end dette, måles positionen igen efter billedet. */
const REMEASURE_AFTER_MS = 30_000;
/** Så længe ventes der på den nye måling, før den fra da kameraet åbnede bruges. */
const REMEASURE_WAIT_MS = 4_000;
/** Har brugeren sagt "Ikke nu" til placering, spørges der igen efter så mange dage. */
const EXPLAIN_AGAIN_AFTER_MS = 14 * 24 * 60 * 60_000;
const EXPLAINED_KEY = "locationExplainedAt";

type SavedPost = {
  id: string;
  tripId: string;
  localImageUri: string;
  takenAt: string;
  coords: Coords | null;
  /** Teksten, som den er gemt i databasen. */
  text: string;
};

type Source = "camera" | "album";

type ChooseReason = "denied" | "unavailable" | "albumUnavailable" | "web";

type Phase =
  | { kind: "start" }
  /** D4: forklaring før systemets dialog om placering. */
  | { kind: "explain" }
  /** Telefonens kamera eller album er åbent. */
  | { kind: "picking" }
  /** Intet billede: mangler tilladelse, kameraet/albummet kunne ikke åbnes, eller vi er på web. */
  | { kind: "choose"; reason: ChooseReason }
  | { kind: "saving"; uri: string; done: number; total: number }
  /** D2: indlæggene er gemt; tekst (ved ét billede) og rejse kan rettes. */
  | { kind: "saved"; posts: SavedPost[]; source: Source }
  /** `photos` er dem, der mangler; `saved` dem, der nåede at blive gemt. */
  | { kind: "error"; photos: PickedPhoto[]; saved: SavedPost[]; source: Source };

/** Er billedet ældre end det, er positionen lige nu ikke stedet, hvor det blev taget. */
const RECENT_PHOTO_MS = 30 * 60_000;

const withTimeout = <T,>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/**
 * Nyt indlæg (redesign D). Åbnes fra arket bag "+" med `source`: telefonens eget
 * kamera eller albummet, hvor man kan vælge flere billeder. Billederne gemmes, så
 * snart de er valgt. Bagefter kan man skrive en tekst, skifte rejse, fortryde eller
 * tilføje flere. Første gang forklares det, hvorfor appen vil bruge placeringen,
 * før systemet spørger.
 */
export default function NewPostScreen() {
  const p = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ recovered?: string; source?: string }>();
  const recovered = params.recovered;
  const initialSource: Source = params.source === "album" ? "album" : "camera";
  const { db, user } = useLocalDb();
  const { trip: activeTrip, defaultTrip, showAll, trips, setActiveTrip, isLoading } = useActiveTrip();
  const createPost = useCreatePost();
  const deletePost = useDeletePost();
  const updateText = useUpdatePostText();

  const [phase, setPhase] = useState<Phase>({ kind: "start" });
  const [locationPerm, setLocationPerm] = useState<LocationPermission>("undetermined");
  const [tripId, setTripId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const started = useRef(false);

  // Med "Alle rejser" valgt forvælges rejsen, der er i gang (ellers den nyeste).
  const trip = trips.find((t) => t.id === tripId) ?? defaultTrip;

  // Tilbage fra "Sæt sted": hent de nye positioner, så sted, vejr og noten passer.
  useFocusEffect(
    useCallback(() => {
      if (phase.kind !== "saved") return;
      let cancelled = false;
      void Promise.all(phase.posts.map((x) => getPost(db, x.id))).then((rows) => {
        if (cancelled) return;
        let changed = false;
        const posts = phase.posts.map((x, i) => {
          const row = rows[i];
          if (!row || row.lat == null || row.lon == null) return x;
          if (row.lat === x.coords?.lat && row.lon === x.coords?.lon) return x;
          changed = true;
          return { ...x, coords: { lat: row.lat, lon: row.lon } };
        });
        if (changed) setPhase({ ...phase, posts });
      });
      return () => {
        cancelled = true;
      };
    }, [phase, db]),
  );

  /** Position for billedet. Spørger ikke om tilladelse; det gør forklaringen (D4). */
  const startFix = (perm: LocationPermission, maxAgeMs: number): Promise<Coords | null> =>
    perm === "granted"
      ? getCurrentCoords({ maxAgeMs, request: false }).then((r) => (r.status === "ok" ? r.coords : null))
      : Promise.resolve(null);

  /** Rejsen, der sidst blev gemt på; den vises, når skærmen lukkes. */
  const lastTripId = useRef<string | null>(null);

  /** Lukker skærmen og viser rejsen, indlæggene kom på – medmindre alle rejser vises. */
  const close = async () => {
    const id = lastTripId.current;
    if (id && !showAll && id !== activeTrip?.id) await setActiveTrip(id);
    router.back();
  };

  /**
   * Gemmer billederne som indlæg med det samme, i den rækkefølge de blev valgt.
   * Tekst kan tilføjes bagefter. `before` er billeder, der allerede er gemt (ved "Prøv igen").
   */
  const saveMany = async (
    photos: PickedPhoto[],
    fix: Promise<Coords | null>,
    source: Source,
    before: SavedPost[] = [],
  ) => {
    if (!trip || photos.length === 0) return;
    const saved = [...before];
    const total = before.length + photos.length;
    for (const [i, photo] of photos.entries()) {
      setPhase({ kind: "saving", uri: photo.uri, done: saved.length, total });
      try {
        const id = Crypto.randomUUID();
        // Først billedfilen, så den er sikret i appens egen mappe.
        const localImageUri = persistPhoto(photo.uri, id);
        // EXIF er den præcise position. Ellers bruges, hvor man er nu – men kun for et
        // nyt billede; et gammelt billede fra albummet ville ellers havne et forkert sted.
        const recent = !photo.takenAt || Date.now() - Date.parse(photo.takenAt) < RECENT_PHOTO_MS;
        const coords = photo.coords ?? (recent ? await withTimeout(fix, CAPTURE_WAIT_MS) : null);
        const takenAt = photo.takenAt ?? new Date().toISOString();
        await createPost.mutateAsync({
          id,
          tripId: trip.id,
          authorId: user.id,
          authorName: user.name,
          text: "",
          takenAt,
          lat: coords?.lat ?? null,
          lon: coords?.lon ?? null,
          // Sted og vejr sætter serveren ved upload.
          placeName: null,
          weather: null,
          countryCode: trip.countryCode ?? null,
          localImageUri,
        });
        lastTripId.current = trip.id;
        saved.push({ id, tripId: trip.id, localImageUri, takenAt, coords, text: "" });
      } catch (e) {
        console.error("[post/new] kunne ikke gemme", e);
        setPhase({ kind: "error", photos: photos.slice(i), saved, source });
        return;
      }
    }
    setText("");
    setTextError(null);
    setPhase({ kind: "saved", posts: saved, source });
  };

  /** Fortrudt i kameraet eller albummet: tilbage til valget, hvis man kom derfra; ellers luk. */
  const canceled = (from: Phase) => {
    if (from.kind === "choose") setPhase(from);
    else void close();
  };

  const openCamera = async (perm: LocationPermission = locationPerm) => {
    const from = phase;
    setPhase({ kind: "picking" });
    // GPS'en startes, mens kameraet er åbent, så positionen som regel er klar, når billedet er taget.
    const openedAt = Date.now();
    let fix = startFix(perm, CAPTURE_MAX_AGE_MS);
    const result = await takePhoto();
    if (result.status === "ok") {
      // Har kameraet været åbent længe (fx i et tog), er målingen fra da det åbnede for gammel.
      // Så måles der igen; kommer den nye ikke i tide, bruges den gamle.
      if (Date.now() - openedAt > REMEASURE_AFTER_MS) {
        const early = fix;
        fix = withTimeout(startFix(perm, CAPTURE_MAX_AGE_MS), REMEASURE_WAIT_MS).then((c) => c ?? early);
      }
      await saveMany([result.photo], fix, "camera");
    }
    else if (result.status === "canceled") canceled(from);
    else setPhase({ kind: "choose", reason: result.status });
  };

  const openAlbum = async (perm: LocationPermission = locationPerm) => {
    const from = phase;
    setPhase({ kind: "picking" });
    const fix = startFix(perm, SCREEN_OPEN_MAX_AGE_MS);
    const result = await pickPhotos();
    if (result.status === "ok") await saveMany(result.photos, fix, "album");
    else if (result.status === "canceled") canceled(from);
    else setPhase({ kind: "choose", reason: "albumUnavailable" });
  };

  const openSource = (perm: LocationPermission) => {
    // På web må kameraet og albummet kun åbnes direkte fra et tryk.
    if (process.env.EXPO_OS === "web") setPhase({ kind: "choose", reason: "web" });
    else if (initialSource === "album") void openAlbum(perm);
    else void openCamera(perm);
  };

  // Første visning: et reddet billede (Android), forklaringen om placering, kameraet eller albummet.
  useEffect(() => {
    if (isLoading || !trip || started.current) return;
    started.current = true;
    void (async () => {
      const perm = await getLocationPermission();
      setLocationPerm(perm);
      const rescued = recovered ? takeRecoveredPhoto() : null;
      if (rescued) {
        await saveMany([rescued], startFix(perm, CAPTURE_MAX_AGE_MS), "camera");
        return;
      }
      if (perm === "undetermined") {
        const explainedAt = await getMeta(db, EXPLAINED_KEY);
        if (!explainedAt || Date.now() - Date.parse(explainedAt) > EXPLAIN_AGAIN_AFTER_MS) {
          setPhase({ kind: "explain" });
          return;
        }
      }
      openSource(perm);
    })();
    // Kører én gang, når rejserne er hentet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, trip]);

  const answerExplain = async (allow: boolean) => {
    await setMeta(db, EXPLAINED_KEY, new Date().toISOString());
    const perm = allow ? await requestLocationPermission() : locationPerm;
    setLocationPerm(perm);
    openSource(perm);
  };

  /** Gemmer en ændret tekst (kun ved ét billede). Falsk, hvis teksten er ugyldig. */
  const commitText = async (posts: SavedPost[], source: Source): Promise<boolean> => {
    const post = posts.length === 1 ? posts[0] : undefined;
    if (!post) return true;
    const parsed = postText.safeParse(text);
    if (!parsed.success) {
      setTextError(parsed.error.issues[0]?.message ?? "Ugyldig tekst");
      return false;
    }
    if (parsed.data !== post.text) {
      await updateText.mutateAsync({ postId: post.id, text: parsed.data });
      setPhase({ kind: "saved", posts: [{ ...post, text: parsed.data }], source });
    }
    return true;
  };

  const finish = async (posts: SavedPost[], source: Source) => {
    if (!(await commitText(posts, source))) return;
    await close();
  };

  const another = async (posts: SavedPost[], source: Source) => {
    if (!(await commitText(posts, source))) return;
    if (source === "album") await openAlbum();
    else await openCamera();
  };

  const undo = async (posts: SavedPost[]) => {
    for (const post of posts) await deletePost.mutateAsync(post.id);
    router.back();
  };

  /**
   * Flytter indlæggene til en anden rejse. De kan allerede være uploadet, så de
   * oprettes som nye indlæg på den nye rejse, og de gamle slettes via upload-køen.
   */
  const moveTo = async (posts: SavedPost[], source: Source, newTripId: string) => {
    const target = trips.find((t) => t.id === newTripId);
    if (!target) return;
    const parsed = postText.safeParse(text);
    const moved: SavedPost[] = [];
    try {
      for (const post of posts) {
        if (post.tripId === newTripId) {
          moved.push(post);
          continue;
        }
        // Ved ét billede følger den skrevne tekst med; ellers har hvert indlæg sin egen.
        const movedText = posts.length === 1 && parsed.success ? parsed.data : post.text;
        const id = Crypto.randomUUID();
        const localImageUri = persistPhoto(post.localImageUri, id);
        await createPost.mutateAsync({
          id,
          tripId: target.id,
          authorId: user.id,
          authorName: user.name,
          text: movedText,
          takenAt: post.takenAt,
          lat: post.coords?.lat ?? null,
          lon: post.coords?.lon ?? null,
          placeName: null,
          weather: null,
          countryCode: target.countryCode ?? null,
          localImageUri,
        });
        await deletePost.mutateAsync(post.id);
        moved.push({ ...post, id, tripId: target.id, localImageUri, text: movedText });
      }
      setTripId(target.id);
      lastTripId.current = target.id;
      setMoveError(null);
      setPhase({ kind: "saved", posts: moved, source });
    } catch (e) {
      console.error("[post/new] kunne ikke flytte indlæggene", e);
      // De flyttede og de resterende. Et nyt forsøg springer dem over, der allerede er flyttet.
      setPhase({ kind: "saved", posts: [...moved, ...posts.slice(moved.length)], source });
      setMoveError(
        posts.length === 1 ? "Indlægget kunne ikke flyttes. Prøv igen." : "Ikke alle billeder blev flyttet. Prøv igen.",
      );
    }
  };

  // Androids tilbage-knap svarer til "Færdig", så en skrevet tekst ikke går tabt.
  useEffect(() => {
    if (phase.kind !== "saved") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      void finish(phase.posts, phase.source);
      return true;
    });
    return () => sub.remove();
  });

  if (isLoading) return <DarkWait />;

  if (!trip) {
    return (
      <Screen>
        <EmptyState icon="airplane-outline" title="Opret en rejse først" message="Indlæg hører til en rejse.">
          <Button label="Ny rejse" icon="add" onPress={() => router.replace("/trip/new")} />
        </EmptyState>
      </Screen>
    );
  }

  switch (phase.kind) {
    case "start":
    case "picking":
      return <DarkWait />;
    case "saving":
      return (
        <DarkWait
          uri={phase.uri}
          label={phase.total > 1 ? `Gemmer ${phase.done + 1} af ${phase.total} …` : "Gemmer …"}
        />
      );
    case "explain":
      return <ExplainLocation onAnswer={answerExplain} />;
    case "choose":
      return (
        <ChoosePhoto
          reason={phase.reason}
          onCamera={() => void openCamera()}
          onAlbum={() => void openAlbum()}
          onClose={() => router.back()}
        />
      );
    case "error": {
      const { photos, saved, source } = phase;
      const total = photos.length + saved.length;
      return (
        <Screen onClose={() => void close()}>
          <EmptyState
            icon="alert-circle-outline"
            title={total === 1 ? "Billedet kunne ikke gemmes" : `${photos.length} billeder kunne ikke gemmes`}
            message={
              saved.length > 0
                ? `${saved.length} af ${total} blev gemt. Der skete en fejl på telefonen med resten. Prøv igen.`
                : "Der skete en fejl på telefonen. Prøv igen."
            }
          >
            <Button label="Prøv igen" onPress={() => void saveMany(photos, Promise.resolve(null), source, saved)} />
            <Button label="Luk" variant="ghost" onPress={() => void close()} />
          </EmptyState>
        </Screen>
      );
    }
    case "saved": {
      const { posts, source } = phase;
      const postTrip = trips.find((t) => t.id === posts[0]?.tripId) ?? trip;
      return (
        <SavedView
          posts={posts}
          source={source}
          trip={postTrip}
          trips={trips}
          locationPerm={locationPerm}
          text={text}
          textError={textError}
          moveError={moveError}
          busy={createPost.isPending || deletePost.isPending || updateText.isPending}
          onText={(v) => {
            setText(v);
            setTextError(null);
          }}
          onUndo={() => void undo(posts)}
          onMove={(id) => void moveTo(posts, source, id)}
          onAnother={() => void another(posts, source)}
          onDone={() => void finish(posts, source)}
          onSetPlace={(ids) => router.push({ pathname: "/post/place", params: { ids: ids.join(",") } })}
        />
      );
    }
  }
}

// ---------------------------------------------------------------------------
// D2: gemt med det samme
// ---------------------------------------------------------------------------

function SavedView({
  posts,
  source,
  trip,
  trips,
  locationPerm,
  text,
  textError,
  moveError,
  busy,
  onText,
  onUndo,
  onMove,
  onAnother,
  onDone,
  onSetPlace,
}: {
  posts: SavedPost[];
  source: Source;
  trip: { id: string; name: string; startDate: string; endDate: string; countryCode: string | null };
  trips: { id: string; name: string }[];
  locationPerm: LocationPermission;
  text: string;
  textError: string | null;
  moveError: string | null;
  busy: boolean;
  onText: (v: string) => void;
  onUndo: () => void;
  onMove: (tripId: string) => void;
  onAnother: () => void;
  onDone: () => void;
  onSetPlace: (postIds: string[]) => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const network = useNetworkState();
  const online = network.isConnected !== false && network.isInternetReachable !== false;
  const [pickingTrip, setPickingTrip] = useState(false);

  // Ved ét billede vises sted, vejr og tekst; ved flere en række med billederne.
  const post = posts[0]!;
  const single = posts.length === 1;
  const tripName = trip.name;
  const coords = post.coords;
  const preview = useQuery({
    // Serveren har preview som mutation, så koordinaterne ikke kommer i URL'en. Her opfører den sig som en læsning.
    queryKey: ["enrich-preview", coords?.lat, coords?.lon, post.takenAt],
    queryFn: () => trpcClient.enrich.preview.mutate({ lat: coords!.lat, lon: coords!.lon, takenAt: post.takenAt }),
    enabled: single && !!coords && online,
    retry: 1,
    staleTime: 10 * 60_000,
  });
  const withoutPosition = posts.filter((x) => !x.coords).length;

  const takenAt = new Date(post.takenAt);
  const day = tripDay(trip.startDate, trip.endDate, takenAt);

  // Et tryk på stedet åbner kortet, hvor man kan sætte eller rette det selv.
  const placeLabel = !coords
    ? locationPerm === "granted"
      ? "Position ikke fundet · sæt sted"
      : "Sæt sted"
    : !online
      ? "Sted hentes ved upload"
      : preview.isLoading
        ? "Finder sted …"
        : (preview.data?.placeName ?? "Ukendt sted");
  const weather = !coords
    ? null
    : !online
      ? "Vejr hentes ved upload"
      : preview.data?.weather
        ? `${Math.round(preview.data.weather.tempC)}° · ${weatherLabel(preview.data.weather.code)}`
        : null;

  return (
    <View style={{ flex: 1, backgroundColor: "#111110" }}>
      <StatusBar style="light" />
      <Image
        source={{ uri: post.localImageUri }}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: height * 0.55 }}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {/* Kvittering øverst: gemt, hvor, og "Fortryd" */}
        <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.lg }}>
          <View
            accessibilityRole="alert"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              padding: space.sm,
              paddingLeft: space.md,
              borderRadius: radius.lg,
              borderCurve: "continuous",
              backgroundColor: p.surface,
              boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
              maxWidth: 640,
              width: "100%",
              alignSelf: "center",
            }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: p.success,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="checkmark" size={18} color={p.surface} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typo.heading, { color: p.text, fontSize: 17, lineHeight: 22 }]} numberOfLines={1}>
                {single ? `Gemt i ${tripName}` : `${posts.length} billeder gemt i ${tripName}`}
              </Text>
              <Text style={{ color: p.textMuted, fontSize: 13 }} numberOfLines={1}>
                {online ? "Sendes til gruppen nu" : "Ligger på telefonen · sendes, når du har net"}
              </Text>
            </View>
            <Button label="Fortryd" variant="secondary" onPress={onUndo} disabled={busy} />
          </View>
        </View>

        <View style={{ flex: 1 }} />

        <View
          style={{
            flexShrink: 1,
            backgroundColor: p.background,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            borderCurve: "continuous",
            maxWidth: 640,
            width: "100%",
            alignSelf: "center",
          }}
        >
          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ padding: space.lg, gap: space.md }}
            keyboardShouldPersistTaps="handled"
          >
            {single ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                <Chip
                  icon="location-outline"
                  label={placeLabel}
                  onPress={() => onSetPlace([post.id])}
                  hint={coords ? "Ret stedet på et kort" : "Vælg på et kort, hvor billedet er taget"}
                />
                {weather ? <Chip icon="partly-sunny-outline" label={weather} /> : null}
                <Chip icon="time-outline" label={`${formatTime(takenAt)}${day ? ` · dag ${day.day}` : ""}`} />
              </View>
            ) : (
              <View style={{ gap: space.sm }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                  {posts.map((x, i) => (
                    <Image
                      key={x.id}
                      source={{ uri: x.localImageUri }}
                      style={{ width: 72, height: 72, borderRadius: radius.sm, backgroundColor: p.placeholder }}
                      contentFit="cover"
                      accessibilityLabel={`Billede ${i + 1} af ${posts.length}`}
                    />
                  ))}
                </ScrollView>
                <Text style={{ color: p.textMuted, fontSize: 14, lineHeight: 20 }}>
                  {withoutPosition === 0
                    ? "Tidspunkt og sted er taget fra billederne."
                    : withoutPosition === posts.length
                      ? "Billederne har ingen position. Sæt stedet selv, så de kommer på kortet."
                      : `${withoutPosition} af billederne har ingen position. Sæt stedet selv, så de kommer på kortet.`}{" "}
                  Du kan skrive en tekst til hvert billede bagefter.
                </Text>
                {withoutPosition > 0 ? (
                  <Button
                    label={withoutPosition === posts.length ? "Sæt sted" : `Sæt sted for de ${withoutPosition}`}
                    icon="location-outline"
                    variant="secondary"
                    onPress={() => onSetPlace(posts.filter((x) => !x.coords).map((x) => x.id))}
                    disabled={busy}
                    accessibilityHint="Vælg på et kort, hvor billederne er taget. De får alle samme sted."
                  />
                ) : null}
              </View>
            )}

            {/* Rejsen kan skiftes her, fordi telefonens kamera ikke kan vise den, før billedet tages. */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingLeft: space.md,
                paddingVertical: 2,
                paddingRight: 2,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: p.border,
                backgroundColor: p.surface,
              }}
            >
              <Text style={{ flex: 1, color: p.textMuted, fontSize: 15 }} numberOfLines={1}>
                Rejse: <Text style={{ color: p.text, fontWeight: "600" }}>{tripName}</Text>
              </Text>
              {trips.length > 1 ? (
                <Button
                  label={pickingTrip ? "Luk" : "Skift"}
                  variant="ghost"
                  onPress={() => setPickingTrip((v) => !v)}
                  disabled={busy}
                  accessibilityHint={single ? "Flyt indlægget til en anden rejse" : "Flyt billederne til en anden rejse"}
                />
              ) : null}
            </View>
            {pickingTrip ? (
              <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {trips.map((t) => {
                  const selected = t.id === post.tripId;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => {
                        setPickingTrip(false);
                        onMove(t.id);
                      }}
                      disabled={busy}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      style={{
                        minHeight: 44,
                        justifyContent: "center",
                        paddingHorizontal: space.md,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: selected ? p.ink : p.borderStrong,
                        backgroundColor: selected ? p.ink : p.surface,
                      }}
                    >
                      <Text style={{ color: selected ? p.onInk : p.text, fontSize: 15, fontWeight: "600" }}>
                        {t.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {moveError ? (
              <Text accessibilityRole="alert" style={{ color: p.danger, fontSize: 14 }}>
                {moveError}
              </Text>
            ) : null}

            {single ? (
              <TextField
                label="Vil du skrive noget?"
                placeholder="Valgfrit – du kan også gøre det senere"
                value={text}
                onChangeText={onText}
                multiline
                counterMax={POST_TEXT_MAX}
                error={textError}
              />
            ) : null}
          </ScrollView>

          <View
            style={{
              flexDirection: "row",
              gap: space.md,
              paddingHorizontal: space.lg,
              paddingTop: space.sm,
              paddingBottom: Math.max(insets.bottom, space.md),
            }}
          >
            <Button
              label={source === "album" ? "Vælg flere" : "Tag et billede mere"}
              icon={source === "album" ? "images-outline" : "camera-outline"}
              variant="secondary"
              size="lg"
              onPress={onAnother}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <Button label="Færdig" size="lg" onPress={onDone} loading={busy} style={{ flex: 1 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Chip({
  icon,
  label,
  onPress,
  hint,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress?: () => void;
  hint?: string;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityHint={hint}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 36,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: p.border,
        backgroundColor: p.surface,
      }}
    >
      <Ionicons name={icon} size={15} color={p.accent} />
      <Text style={{ color: p.text, fontSize: 14, textDecorationLine: onPress ? "underline" : "none" }}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// D4: forklaring før tilladelsen til placering
// ---------------------------------------------------------------------------

function ExplainLocation({ onAnswer }: { onAnswer: (allow: boolean) => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const answer = (allow: boolean) => {
    setBusy(true);
    onAnswer(allow);
  };
  const points = [
    "Kun mens du bruger appen, aldrig i baggrunden",
    "Bruges til sted, vejr og kortet over rejsen",
    "Du kan slå det fra i telefonens indstillinger",
  ];
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: p.background }}
      contentContainerStyle={{
        flexGrow: 1,
        gap: space.lg,
        paddingHorizontal: space.xl,
        paddingTop: insets.top + space.xxl,
        paddingBottom: Math.max(insets.bottom, space.lg),
        maxWidth: 520,
        width: "100%",
        alignSelf: "center",
      }}
    >
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          backgroundColor: p.surfaceMuted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="location" size={44} color={p.accent} />
      </View>
      <Text accessibilityRole="header" style={[typo.hero, { color: p.text }]}>
        Sæt dine billeder på kortet
      </Text>
      <Text style={{ color: p.textMuted, fontSize: 17, lineHeight: 24 }}>
        Når du tager et billede, kan appen selv skrive sted og vejr på indlægget.
      </Text>
      <View style={{ gap: space.md }}>
        {points.map((point) => (
          <View key={point} style={{ flexDirection: "row", gap: space.md }}>
            <Ionicons name="checkmark" size={22} color={p.success} />
            <Text style={{ flex: 1, color: p.text, fontSize: 16, lineHeight: 22 }}>{point}</Text>
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ gap: space.sm }}>
        <Button label="Tillad placering" size="lg" onPress={() => answer(true)} loading={busy} />
        <Button label="Ikke nu" variant="ghost" onPress={() => answer(false)} disabled={busy} />
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Intet billede endnu
// ---------------------------------------------------------------------------

const CHOOSE_TEXT: Record<ChooseReason, { title: string; message: string }> = {
  denied: {
    title: "Ingen adgang til kameraet",
    message: "Giv appen adgang i telefonens indstillinger, eller vælg et billede fra dit album.",
  },
  unavailable: { title: "Kameraet kunne ikke åbnes", message: "Vælg et billede fra dit album i stedet." },
  albumUnavailable: {
    title: "Albummet kunne ikke åbnes",
    message: "Prøv igen, eller tag et billede med kameraet.",
  },
  web: { title: "Nyt indlæg", message: "Tag et billede, eller vælg et fra dit album." },
};

function ChoosePhoto({
  reason,
  onCamera,
  onAlbum,
  onClose,
}: {
  reason: ChooseReason;
  onCamera: () => void;
  onAlbum: () => void;
  onClose: () => void;
}) {
  const { title, message } = CHOOSE_TEXT[reason];
  return (
    <Screen onClose={onClose}>
      <EmptyState icon="camera-outline" title={title} message={message}>
        {reason === "denied" ? (
          <Button label="Åbn indstillinger" icon="settings-outline" onPress={() => void Linking.openSettings()} />
        ) : reason !== "unavailable" ? (
          <Button label="Åbn kameraet" icon="camera" onPress={onCamera} />
        ) : null}
        <Button
          label={reason === "albumUnavailable" ? "Prøv albummet igen" : "Vælg fra album"}
          icon="images-outline"
          variant={reason === "unavailable" ? "primary" : "secondary"}
          onPress={onAlbum}
        />
      </EmptyState>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Fælles
// ---------------------------------------------------------------------------

/** Lys skærm med en luk-knap øverst (skærmen har ingen header). */
function Screen({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: p.background, paddingTop: insets.top }}>
      <Pressable
        onPress={onClose ?? (() => router.back())}
        accessibilityRole="button"
        accessibilityLabel="Luk"
        hitSlop={8}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          margin: space.sm,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? p.surfaceMuted : "transparent",
        })}
      >
        <Ionicons name="close" size={26} color={p.text} />
      </Pressable>
      {children}
    </View>
  );
}

/** Mørk skærm, mens telefonens kamera er åbent eller billedet gemmes. */
function DarkWait({ uri, label }: { uri?: string; label?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: "#111110", alignItems: "center", justifyContent: "center", gap: space.md }}>
      <StatusBar style="light" />
      {uri ? (
        <Image
          source={{ uri }}
          style={{ position: "absolute", inset: 0, opacity: 0.5 }}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <ActivityIndicator color="#FFFFFF" />
      {label ? <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "600" }}>{label}</Text> : null}
    </View>
  );
}
