import Ionicons from "@expo/vector-icons/Ionicons";
import type { PlaceSearchResult } from "@rejsedagbog/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNetworkState } from "expo-network";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { PlacePickerMap, type LngLat, type PlacePickerMapHandle } from "@/components/place-picker-map";
import { apiErrorMessage } from "@/lib/api-errors";
import { useLocalDb } from "@/lib/local-db/provider";
import { usePosts, useSetPostPosition, useTrips } from "@/lib/local-db/queries";
import { getPost } from "@/lib/local-db/repo";
import { hasPosition, viewForPosts, type MapView } from "@/lib/map-view";
import { getCurrentCoords, SCREEN_OPEN_MAX_AGE_MS } from "@/lib/media";
import { MIN_TOUCH, radius, scaledLines, space, typo, usePalette } from "@/lib/theme";
import { trpcClient } from "@/utils/trpc";

/** Hele verden, når hverken indlægget eller rejsen har en position at starte fra. */
const WORLD: MapView = { kind: "center", center: [10, 30], zoom: 1.5 };

/**
 * Sæt sted (fx på billeder fra albummet, hvor Android har fjernet positionen). `ids`
 * er et eller flere af brugerens egne indlæg, kommasepareret; de får alle samme sted.
 * Man søger efter stedet eller flytter kortet, så nålen står rigtigt.
 */
export default function SetPlaceScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { db, user } = useLocalDb();
  const params = useLocalSearchParams<{ ids?: string }>();
  const ids = useMemo(() => (params.ids ?? "").split(",").filter(Boolean), [params.ids]);

  const posts = useQuery({
    queryKey: ["local", user.id, "place-posts", ...ids],
    queryFn: async () => (await Promise.all(ids.map((id) => getPost(db, id)))).filter((x) => x !== null),
    enabled: ids.length > 0,
  });
  const own = (posts.data ?? []).filter((x) => x.authorId === user.id);
  const first = own[0];
  const trips = useTrips();
  const trip = trips.data?.find((t) => t.id === first?.tripId);
  const tripPosts = usePosts(first?.tripId);
  const setPosition = useSetPostPosition();

  const network = useNetworkState();
  const online = network.isConnected !== false && network.isInternetReachable !== false;

  const map = useRef<PlacePickerMapHandle>(null);
  const [center, setCenter] = useState<LngLat | null>(null);
  /** Har brugeren selv valgt et sted (flyttet kortet, søgt eller trykket)? Før det kan der ikke gemmes. */
  const [chosen, setChosen] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: (q: string) => trpcClient.enrich.searchPlaces.mutate({ query: q, countryCodes: trip?.countryCodes }),
    onSuccess: (r) => setResults(r),
  });

  // Start: indlæggets egen position, ellers rejsens andre indlæg, ellers hele verden.
  const initial = useMemo<MapView | null>(() => {
    if (!posts.data || tripPosts.isLoading) return null;
    if (first && hasPosition(first)) return { kind: "center", center: [first.lon, first.lat], zoom: 15 };
    return viewForPosts((tripPosts.data ?? []).filter(hasPosition)) ?? WORLD;
  }, [posts.data, tripPosts.isLoading, tripPosts.data, first]);

  const choose = (target: LngLat, name: string | null) => {
    setCenter(target);
    setChosen(true);
    setLabel(name);
    setResults(null);
    map.current?.flyTo(target);
  };

  const runSearch = () => {
    const q = query.trim();
    if (q.length < 2) return;
    setNotice(null);
    search.mutate(q);
  };

  const locate = async () => {
    setLocating(true);
    setNotice(null);
    const r = await getCurrentCoords({ maxAgeMs: SCREEN_OPEN_MAX_AGE_MS });
    setLocating(false);
    if (r.status === "ok") choose([r.coords.lon, r.coords.lat], "Din position");
    else setNotice(r.status === "denied" ? "Appen har ikke adgang til din position." : "Din position kunne ikke findes.");
  };

  const save = async () => {
    if (!center) return;
    await setPosition.mutateAsync({ postIds: own.map((x) => x.id), coords: { lat: center[1], lon: center[0] } });
    router.back();
  };

  if (posts.isLoading || !initial) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: p.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (own.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background, paddingTop: insets.top }}>
        <EmptyState icon="location-outline" title="Indlægget findes ikke" message="Du kan kun sætte sted på dine egne indlæg.">
          <Button label="Luk" variant="secondary" onPress={() => router.back()} />
        </EmptyState>
      </View>
    );
  }

  const searchError = search.error
    ? apiErrorMessage(search.error, "Søgning kræver net. Du kan stadig flytte kortet.")
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      {/* Top: luk og søgning */}
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingHorizontal: space.md,
          paddingBottom: space.sm,
          gap: space.sm,
          backgroundColor: p.background,
          zIndex: 2,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Luk uden at gemme"
            style={({ pressed }) => ({
              width: MIN_TOUCH,
              height: MIN_TOUCH,
              borderRadius: MIN_TOUCH / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? p.surfaceMuted : "transparent",
            })}
          >
            <Ionicons name="close" size={26} color={p.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[typo.eyebrow, { color: p.textMuted }]}>
              {own.length > 1 ? `${own.length} BILLEDER` : first?.lat != null ? "RET STED" : "SÆT STED"}
            </Text>
            <Text accessibilityRole="header" style={[typo.heading, { color: p.text }]} numberOfLines={scaledLines(1)}>
              Hvor er billedet taget?
            </Text>
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingLeft: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: p.borderStrong,
            backgroundColor: p.surface,
          }}
        >
          <Ionicons name="search" size={18} color={p.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={runSearch}
            placeholder={trip?.countryCodes.length ? "Søg efter sted, fx en by eller seværdighed" : "Søg efter sted"}
            placeholderTextColor={p.textMuted}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Søg efter sted"
            style={{ flex: 1, minHeight: 48, color: p.text, fontSize: 16 }}
          />
          <Button
            label="Søg"
            variant="ghost"
            onPress={runSearch}
            loading={search.isPending}
            disabled={!online || query.trim().length < 2}
          />
        </View>
        {!online ? (
          <Text style={{ color: p.textMuted, fontSize: 13 }}>Søgning kræver net. Du kan stadig flytte kortet.</Text>
        ) : null}
      </View>

      <View style={{ flex: 1 }}>
        <PlacePickerMap
          ref={map}
          initial={initial}
          onCenterChange={(c) => {
            setCenter(c);
          }}
          onUserMove={() => {
            setChosen(true);
            setLabel(null);
          }}
        />

        {/* Søgeresultater over kortet */}
        {results || searchError ? (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: space.md,
              right: space.md,
              maxHeight: "60%",
              backgroundColor: p.surface,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: p.border,
              boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
              overflow: "hidden",
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              {searchError ? (
                <Text style={{ color: p.danger, fontSize: 14, padding: space.md }}>{searchError}</Text>
              ) : results && results.length === 0 ? (
                <Text style={{ color: p.textMuted, fontSize: 14, padding: space.md }}>
                  Intet fundet. Prøv et andet navn, eller flyt kortet selv.
                </Text>
              ) : (
                results?.map((r, i) => (
                  <Pressable
                    key={`${r.lat},${r.lon},${i}`}
                    onPress={() => choose([r.lon, r.lat], r.name)}
                    accessibilityRole="button"
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.md,
                      minHeight: 56,
                      paddingHorizontal: space.md,
                      paddingVertical: space.sm,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: p.border,
                      backgroundColor: pressed ? p.surfaceMuted : "transparent",
                    })}
                  >
                    <Ionicons name="location-outline" size={20} color={p.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: p.text, fontSize: 16, fontWeight: "600" }} numberOfLines={scaledLines(1)}>
                        {r.name}
                      </Text>
                      {r.detail ? (
                        <Text style={{ color: p.textMuted, fontSize: 13 }} numberOfLines={scaledLines(1)}>
                          {r.detail}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))
              )}
            </ScrollView>
            <Button
              label="Luk listen"
              variant="ghost"
              onPress={() => {
                setResults(null);
                search.reset();
              }}
            />
          </View>
        ) : null}

        {process.env.EXPO_OS !== "web" ? (
          <Pressable
            onPress={() => void locate()}
            accessibilityRole="button"
            accessibilityLabel="Brug min position"
            hitSlop={8}
            style={({ pressed }) => ({
              position: "absolute",
              right: space.lg,
              bottom: space.xl,
              width: 48,
              height: 48,
              borderRadius: 24,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? p.surfaceMuted : p.surface,
              borderWidth: 1,
              borderColor: p.border,
              boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
            })}
          >
            {locating ? <ActivityIndicator /> : <Ionicons name="locate" size={22} color={p.text} />}
          </Pressable>
        ) : null}
      </View>

      {/* Bund: hvad der gemmes */}
      <View
        style={{
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: Math.max(insets.bottom, space.md),
          gap: space.sm,
          backgroundColor: p.background,
          borderTopWidth: 1,
          borderTopColor: p.border,
        }}
      >
        <Text style={{ color: notice ? p.danger : p.textMuted, fontSize: 14 }} numberOfLines={scaledLines(2)}>
          {notice ??
            (!chosen
              ? process.env.EXPO_OS === "web"
                ? "Søg efter stedet, og vælg det på listen."
                : "Søg efter stedet, eller flyt kortet, så nålen står, hvor billedet er taget."
              : label
                ? `Valgt: ${label}`
                : "Nålen står, hvor billedet er taget. Stednavn og vejr findes, når det sendes.")}
        </Text>
        <Button
          label={own.length > 1 ? `Gem sted for ${own.length} billeder` : "Gem sted"}
          size="lg"
          onPress={() => void save()}
          disabled={!chosen || !center}
          loading={setPosition.isPending}
        />
      </View>
    </View>
  );
}
