import Ionicons from "@expo/vector-icons/Ionicons";
import { formatCountryFacts, formatWeather, POST_TEXT_MAX } from "@rejsedagbog/shared";
import { useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { useNetworkState } from "expo-network";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { TextField } from "@/components/text-field";
import { formatRelative } from "@/lib/dates";
import { useLocalDb } from "@/lib/local-db/provider";
import { useActiveTrip, useCountryFacts, useCreatePost } from "@/lib/local-db/queries";
import {
  CAPTURE_MAX_AGE_MS,
  getCurrentCoords,
  persistPhoto,
  pickPhoto,
  takePhoto,
  type Coords,
  type PickedPhoto,
  type PickResult,
} from "@/lib/media";
import { radius, space, usePalette } from "@/lib/theme";
import { trpcClient } from "@/utils/trpc";

type LocationState =
  | { status: "loading" }
  // gps: estimat fra da skærmen blev åbnet · capture: målt da billedet blev taget · photo: billedets EXIF
  | { status: "ok"; coords: Coords; source: "gps" | "capture" | "photo" }
  | { status: "denied" }
  | { status: "unavailable" };

/** Så længe venter "Gem indlæg" højst på positionen fra da billedet blev taget. */
const CAPTURE_WAIT_MS = 5_000;

/**
 * Opret indlæg (wireframe 3). Maks. tre tryk: "+" → "Tag billede" → "Gem indlæg".
 * Indlægget gemmes altid først lokalt; sted og vejr hentes nu, hvis der er net,
 * ellers af serveren ved upload.
 */
export default function NewPostScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useLocalDb();
  const { trip: activeTrip, trips, setActiveTrip, isLoading } = useActiveTrip();
  const createPost = useCreatePost();
  const network = useNetworkState();
  const online = network.isConnected !== false && network.isInternetReachable !== false;

  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [text, setText] = useState("");
  const [tripId, setTripId] = useState<string | null>(null);
  const [takenAt, setTakenAt] = useState(() => new Date().toISOString());
  const [location, setLocation] = useState<LocationState>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Målingen af positionen for det seneste billede. Hvert nyt billede får et nyt nummer, så en
  // langsom måling for et tidligere billede ikke overskriver positionen for det nyeste.
  const capture = useRef<{ seq: number; pending: Promise<Coords | null> | null }>({ seq: 0, pending: null });
  const [locating, setLocating] = useState(false);

  const trip = trips.find((t) => t.id === tripId) ?? activeTrip;

  // GPS ("mens appen bruges") hentes, når skærmen åbnes – dvs. når funktionen bruges.
  // Det er kun et estimat til forhåndsvisningen; positionen for billedet måles, når det tages.
  useEffect(() => {
    let cancelled = false;
    getCurrentCoords().then((r) => {
      if (cancelled) return;
      setLocation((prev) =>
        prev.status === "ok" && prev.source !== "gps"
          ? prev
          : r.status === "ok"
            ? { status: "ok", coords: r.coords, source: "gps" }
            : r,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const coords = location.status === "ok" ? location.coords : null;
  const preview = useQuery({
    // Serveren har preview som mutation, så koordinaterne ikke kommer i URL'en. Her opfører den sig som en læsning.
    queryKey: ["enrich-preview", coords?.lat, coords?.lon, takenAt],
    queryFn: () => trpcClient.enrich.preview.mutate({ lat: coords!.lat, lon: coords!.lon, takenAt }),
    enabled: !!coords && online,
    retry: 1,
    staleTime: 10 * 60_000,
  });
  const countryCode = preview.data?.countryCode ?? trip?.countryCode ?? null;
  const facts = useCountryFacts(countryCode);

  /** Returnerer billedets nummer (se `capture`), eller null hvis intet billede blev valgt. */
  const handlePick = (result: PickResult): number | null => {
    setError(null);
    if (result.status === "denied") {
      setError("Appen har ikke adgang til kameraet. Giv adgang i telefonens indstillinger.");
      return null;
    }
    if (result.status !== "ok") return null;
    const seq = ++capture.current.seq;
    capture.current.pending = null;
    setLocating(false);
    setPhoto(result.photo);
    // Brug billedets eget tidspunkt og position (EXIF), hvis de findes.
    setTakenAt(result.photo.takenAt ?? new Date().toISOString());
    if (result.photo.coords) setLocation({ status: "ok", coords: result.photo.coords, source: "photo" });
    return seq;
  };

  /**
   * Positionen skal være der, hvor billedet blev taget – ikke hvor skærmen blev åbnet, og
   * ikke en position fra for 2 min siden (i et tog er det flere km). GPS'en startes, mens
   * kameraet er åbent, så målingen som regel er klar, når billedet er taget.
   */
  const onTakePhoto = async () => {
    const fix = getCurrentCoords({ maxAgeMs: CAPTURE_MAX_AGE_MS });
    const result = await takePhoto();
    const seq = handlePick(result);
    // EXIF-position fra kameraet er den præcise position for billedet.
    if (seq === null || (result.status === "ok" && result.photo.coords)) return;

    setLocating(true);
    const pending = fix.then((r) => {
      if (capture.current.seq !== seq) return null; // et nyere billede er valgt
      // Mislykkes målingen, beholdes estimatet fra da skærmen blev åbnet.
      if (r.status === "ok") setLocation({ status: "ok", coords: r.coords, source: "capture" });
      return r.status === "ok" ? r.coords : null;
    });
    capture.current.pending = pending;
    await pending;
    if (capture.current.seq === seq) {
      capture.current.pending = null;
      setLocating(false);
    }
  };

  const save = async () => {
    if (!photo || !trip) return;
    setError(null);
    setSaving(true);
    try {
      // Trykkes der "Gem", før positionen for billedet er målt, ventes der kort på den.
      const pending = capture.current.pending;
      const measured = pending
        ? await Promise.race([pending, new Promise<null>((resolve) => setTimeout(() => resolve(null), CAPTURE_WAIT_MS))])
        : null;
      const finalCoords = measured ?? coords;
      // Sted og vejr i forhåndsvisningen hører til de gamle koordinater; serveren beriger ved upload.
      const previewMatches = !measured || (measured.lat === coords?.lat && measured.lon === coords?.lon);

      const id = Crypto.randomUUID();
      const localImageUri = persistPhoto(photo.uri, id);
      await createPost.mutateAsync({
        id,
        tripId: trip.id,
        authorId: user.id,
        authorName: user.name,
        text: text.trim(),
        takenAt,
        lat: finalCoords?.lat ?? null,
        lon: finalCoords?.lon ?? null,
        placeName: previewMatches ? (preview.data?.placeName ?? null) : null,
        weather: previewMatches ? (preview.data?.weather ?? null) : null,
        countryCode: previewMatches ? countryCode : (trip.countryCode ?? null),
        localImageUri,
      });
      if (trip.id !== activeTrip?.id) await setActiveTrip(trip.id);
      router.back();
    } catch (e) {
      console.error("[post/new] kunne ikke gemme", e);
      setError("Indlægget kunne ikke gemmes på telefonen. Prøv igen.");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <ActivityIndicator style={{ marginTop: space.xxl }} />;

  if (!trip) {
    return (
      <EmptyState icon="airplane-outline" title="Opret en rejse først" message="Indlæg hører til en rejse.">
        <Button label="Ny rejse" icon="add" onPress={() => router.replace("/trip/new")} />
      </EmptyState>
    );
  }

  const placeValue = locating
    ? "Finder position …"
    : !coords
    ? location.status === "loading"
      ? "Finder position …"
      : location.status === "denied"
        ? "Ingen adgang til position"
        : "Position ikke tilgængelig"
    : !online
      ? "Hentes ved upload"
      : preview.isLoading
        ? "Henter …"
        : (preview.data?.placeName ?? "Ukendt sted");
  const weatherValue = locating
    ? "Henter …"
    : !coords
    ? "–"
    : !online
      ? "Hentes ved upload"
      : preview.isLoading
        ? "Henter …"
        : preview.data?.weather
          ? formatWeather(preview.data.weather)
          : "Ikke tilgængeligt";

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={process.env.EXPO_OS === "ios" ? 64 : 0}
      style={{ flex: 1, backgroundColor: p.background }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          gap: space.lg,
          maxWidth: 640,
          width: "100%",
          alignSelf: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Billede */}
        <View
          style={{
            borderRadius: radius.lg,
            borderCurve: "continuous",
            borderWidth: photo ? 0 : 1,
            borderStyle: "dashed",
            borderColor: p.borderStrong,
            backgroundColor: p.surfaceMuted,
            overflow: "hidden",
          }}
        >
          {photo ? (
            <View>
              <Image source={{ uri: photo.uri }} style={{ width: "100%", aspectRatio: 4 / 3 }} contentFit="cover" />
              <View style={{ flexDirection: "row", gap: space.sm, padding: space.sm, justifyContent: "flex-end" }}>
                <Button label="Tag nyt" icon="camera-outline" variant="secondary" onPress={onTakePhoto} />
                <Button label="Vælg andet" icon="images-outline" variant="secondary" onPress={() => pickPhoto().then(handlePick)} />
              </View>
            </View>
          ) : (
            <View style={{ aspectRatio: 4 / 3, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.lg }}>
              <Ionicons name="camera-outline" size={36} color={p.textMuted} />
              <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap", justifyContent: "center" }}>
                <Button label="Tag billede" icon="camera" onPress={onTakePhoto} />
                <Button label="Vælg fra galleri" variant="secondary" onPress={() => pickPhoto().then(handlePick)} />
              </View>
            </View>
          )}
        </View>

        <TextField
          label="Beskrivelse"
          placeholder="Hvad skete der her?"
          value={text}
          onChangeText={setText}
          multiline
          counterMax={POST_TEXT_MAX}
        />

        {/* Rejse */}
        <View style={{ gap: space.xs }}>
          <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>Rejse</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {trips.map((t) => {
              const selected = t.id === trip.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setTripId(t.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  style={{
                    paddingHorizontal: space.md,
                    paddingVertical: space.sm,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: selected ? p.ink : p.borderStrong,
                    backgroundColor: selected ? p.ink : p.surface,
                  }}
                >
                  <Text style={{ color: selected ? p.onInk : p.text, fontSize: 15, fontWeight: "600" }}>
                    {t.name}
                    {t.memberCount > 1 ? " (gruppe)" : ""}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Hentes automatisk */}
        <View style={{ borderWidth: 1, borderColor: p.border, borderRadius: radius.md, overflow: "hidden", backgroundColor: p.surface }}>
          <Text
            style={{
              backgroundColor: p.surfaceMuted,
              color: p.textMuted,
              fontSize: 12,
              fontWeight: "700",
              letterSpacing: 1,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
            }}
          >
            HENTES AUTOMATISK
          </Text>
          <AutoRow label="Sted" value={placeValue} />
          <AutoRow label="Vejr" value={weatherValue} />
          <AutoRow label="Land" value={countryCode ? formatCountryFacts(countryCode, facts.data) : "–"} />
          <AutoRow label="Tidspunkt" value={formatRelative(takenAt)} />
        </View>

        {location.status === "denied" ? (
          <Notice>
            Uden adgang til position kan sted og vejr ikke tilføjes.{" "}
            <Text style={{ textDecorationLine: "underline" }} onPress={() => Linking.openSettings()}>
              Åbn indstillinger
            </Text>
          </Notice>
        ) : null}
        <Notice>
          {online
            ? "Indlægget gemmes på telefonen og uploades automatisk."
            : "Ingen forbindelse? Indlægget gemmes på telefonen og uploades automatisk, når du er online igen."}
        </Notice>

        {error ? (
          <Text selectable accessibilityRole="alert" style={{ color: p.danger, fontSize: 15 }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: p.border,
          backgroundColor: p.surface,
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: Math.max(insets.bottom, space.md),
        }}
      >
        <Button
          label="Gem indlæg"
          size="lg"
          onPress={save}
          disabled={!photo}
          loading={saving}
          accessibilityHint={photo ? undefined : "Tag eller vælg et billede først"}
          style={{ maxWidth: 640, width: "100%", alignSelf: "center" }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function AutoRow({ label, value }: { label: string; value: string }) {
  const p = usePalette();
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm + 2,
        borderTopWidth: 1,
        borderTopColor: p.border,
      }}
    >
      <Text style={{ color: p.textMuted, fontSize: 15 }}>{label}</Text>
      <Text selectable style={{ color: p.text, fontSize: 15, flexShrink: 1, textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}

function Notice({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ backgroundColor: p.surfaceMuted, borderRadius: radius.md, padding: space.md }}>
      <Text style={{ color: p.textMuted, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}
