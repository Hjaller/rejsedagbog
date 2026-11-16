import Ionicons from "@expo/vector-icons/Ionicons";
import { countryName, flagEmoji } from "@rejsedagbog/shared";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { ProfileButton } from "@/components/profile-button";
import { formatDateRange } from "@/lib/dates";
import { ALL_TRIPS, useActiveTrip, usePostCounts } from "@/lib/local-db/queries";
import type { LocalTrip } from "@/lib/local-db/repo";
import { radius, space, typo, usePalette } from "@/lib/theme";

/** Frimærkernes farver. Hvert land får altid den samme; alle har hvid tekst med kontrast ≥ 4,5:1. */
const STAMP_COLORS = ["#B9472A", "#2F5D8A", "#3F6B4A", "#6A4C7D", "#8A5A1E", "#2E6B6B", "#7A3B52"];

function stampColor(countryCode: string | null): string {
  const code = countryCode ?? "";
  let h = 0;
  for (let i = 0; i < code.length; i++) h = h * 31 + code.charCodeAt(i);
  return STAMP_COLORS[h % STAMP_COLORS.length]!;
}

/** Rejser (redesign D): hver rejse er et frimærke; øverst står hele samlingen. */
export default function TripsScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { trip: active, showAll, trips, setActiveTrip, isLoading } = useActiveTrip();
  const counts = usePostCounts();
  const totalPosts = trips.reduce((sum, t) => sum + (counts.data?.[t.id] ?? 0), 0);
  const countries = new Set(trips.map((t) => t.countryCode)).size;
  const columns = width >= 900 ? 4 : width >= 600 ? 3 : 2;

  const choose = async (tripId: string) => {
    await setActiveTrip(tripId);
    router.navigate("/");
  };

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.lg }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <View style={{ gap: 2 }}>
          <Text style={[typo.eyebrow, { color: p.textMuted }]}>REJSEPOST</Text>
          <Text accessibilityRole="header" style={[typo.hero, { color: p.text }]}>
            Mine rejser
          </Text>
        </View>
        <ProfileButton />
      </View>

      {trips.length > 1 ? (
        // Hele samlingen. Et tryk viser alle rejser i tidslinje, galleri og kort.
        <Pressable
          onPress={() => choose(ALL_TRIPS)}
          accessibilityRole="button"
          accessibilityState={{ selected: showAll }}
          accessibilityLabel={`Alle rejser: ${trips.length} rejser, ${countries} lande, ${totalPosts} indlæg`}
          accessibilityHint="Vis indlæg fra alle rejser i tidslinjen, galleriet og på kortet"
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            backgroundColor: p.ink,
            borderRadius: radius.sm,
            padding: space.lg,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Stat value={trips.length} label="rejser" />
          <Stat value={countries} label={countries === 1 ? "land" : "lande"} />
          <Stat value={totalPosts} label="indlæg" />
          <View style={{ alignItems: "center", gap: 2 }}>
            <Ionicons name={showAll ? "checkmark-circle" : "earth-outline"} size={24} color={p.onInk} />
            <Text style={{ color: p.onInk, fontSize: 12 }}>{showAll ? "Vises" : "Vis alle"}</Text>
          </View>
        </Pressable>
      ) : null}

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Ny rejse" icon="add" onPress={() => router.push("/trip/new")} style={{ flex: 1 }} />
        <Button
          label="Tilslut med kode"
          variant="secondary"
          onPress={() => router.push("/trip/join")}
          accessibilityHint="Tilslut en grupperejse med en invitationskode"
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );

  if (isLoading) {
    return <ActivityIndicator style={{ marginTop: insets.top + space.xxl }} />;
  }

  if (trips.length === 0) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top + space.md, paddingHorizontal: space.lg }}>
        {header}
        <EmptyState
          icon="airplane-outline"
          title="Ingen rejser endnu"
          message="Opret en rejse med navn, land og datoer. Det virker også uden internet. Har du fået en invitationskode, så tryk på Tilslut med kode."
        />
      </View>
    );
  }

  return (
    <FlatList
      key={columns}
      data={trips}
      numColumns={columns}
      keyExtractor={(t) => t.id}
      ListHeaderComponent={header}
      columnWrapperStyle={{ gap: space.lg }}
      contentContainerStyle={{
        paddingTop: insets.top + space.md,
        paddingHorizontal: space.lg,
        paddingBottom: space.xxl,
        gap: space.lg,
        maxWidth: 960,
        width: "100%",
        alignSelf: "center",
      }}
      renderItem={({ item }) => (
        <View style={{ flex: 1 / columns }}>
          <Stamp
            trip={item}
            postCount={counts.data?.[item.id] ?? 0}
            active={!showAll && item.id === active?.id}
            onPress={() => choose(item.id)}
            onGroup={() => router.push({ pathname: "/trip/members/[id]", params: { id: item.id } })}
          />
        </View>
      )}
    />
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1 }}>
      <Text style={[typo.title, { color: p.onInk, fontVariant: ["tabular-nums"] }]}>{value}</Text>
      <Text style={{ color: p.onInk, opacity: 0.75, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

/** Et frimærke med takket kant: landekode, navn, datoer og gruppen. */
function Stamp({
  trip,
  postCount,
  active,
  onPress,
  onGroup,
}: {
  trip: LocalTrip;
  postCount: number;
  active: boolean;
  onPress: () => void;
  onGroup: () => void;
}) {
  const p = usePalette();
  const localOnly = trip.syncStatus !== "synkroniseret";
  const color = stampColor(trip.countryCode);
  const top = [active ? "AKTIV" : null, localOnly ? "KUN PÅ TELEFONEN" : null].filter(Boolean).join(" · ");
  return (
    <View
      style={{
        // Ring om den aktive rejse
        borderWidth: 2,
        borderColor: active ? p.ink : "transparent",
        borderRadius: 3,
        padding: 2,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`${trip.name}, ${countryName(trip.countryCode)}, ${formatDateRange(trip.startDate, trip.endDate)}, ${postCount} indlæg`}
        accessibilityHint="Vis rejsens tidslinje"
        style={({ pressed }) => ({
          backgroundColor: p.surface,
          // Prikker i papirfarven på en hvid kant ligner frimærkets takker.
          borderWidth: 5,
          borderStyle: "dotted",
          borderColor: p.background,
          padding: 4,
          gap: space.sm,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <View
          style={{
            height: 104,
            padding: space.sm + 2,
            justifyContent: "space-between",
            backgroundColor: localOnly ? "transparent" : color,
            borderWidth: localOnly ? 1.5 : 0,
            borderStyle: "dashed",
            borderColor: p.borderStrong,
          }}
        >
          <Text style={[typo.eyebrow, { color: localOnly ? p.textMuted : "#FFFFFF", fontSize: 10, letterSpacing: 1 }]} numberOfLines={1}>
            {top || " "}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
            <Text style={[typo.hero, { color: localOnly ? p.text : "#FFFFFF", fontSize: 38, lineHeight: 42 }]}>
              {(trip.countryCode ?? "–").toUpperCase()}
            </Text>
            <Text style={{ fontSize: 22 }}>{flagEmoji(trip.countryCode)}</Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: 2, gap: 2 }}>
          <Text style={[typo.heading, { color: p.text, fontSize: 17, lineHeight: 22 }]} numberOfLines={1}>
            {trip.name}
          </Text>
          <Text style={{ color: p.textMuted, fontSize: 12 }} numberOfLines={1}>
            {formatDateRange(trip.startDate, trip.endDate)} · {postCount} indlæg
          </Text>
        </View>
        <Pressable
          onPress={onGroup}
          accessibilityRole="button"
          accessibilityLabel={trip.memberCount > 1 ? `Gruppen på ${trip.name}` : `Invitér til ${trip.name}`}
          hitSlop={6}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            minHeight: 36,
            paddingHorizontal: 2,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name={trip.memberCount > 1 ? "people-outline" : "person-add-outline"} size={16} color={p.text} />
          <Text style={{ color: p.text, fontSize: 13, textDecorationLine: "underline" }}>
            {trip.memberCount > 1 ? `${trip.memberCount} i gruppen` : "Invitér"}
          </Text>
        </Pressable>
      </Pressable>
    </View>
  );
}
