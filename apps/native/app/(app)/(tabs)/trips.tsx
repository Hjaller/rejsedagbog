import Ionicons from "@expo/vector-icons/Ionicons";
import { countryName, flagEmoji } from "@rejsedagbog/shared";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { formatDateRange } from "@/lib/dates";
import { allTripsSummary } from "@/components/trip-header";
import { ALL_TRIPS, useActiveTrip, usePostCounts } from "@/lib/local-db/queries";
import { radius, space, usePalette } from "@/lib/theme";

export default function TripsScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trip: active, showAll, trips, setActiveTrip, isLoading } = useActiveTrip();
  const counts = usePostCounts();
  const totalPosts = trips.reduce((sum, t) => sum + (counts.data?.[t.id] ?? 0), 0);

  const choose = async (tripId: string) => {
    await setActiveTrip(tripId);
    router.navigate("/");
  };

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg,
          paddingBottom: space.md,
          backgroundColor: p.surface,
          borderBottomWidth: 1,
          borderBottomColor: p.border,
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-between",
        }}
      >
        <View>
          <Text style={{ color: p.textMuted, fontSize: 12, letterSpacing: 1.2 }}>REJSEPOST</Text>
          <Text style={{ color: p.text, fontSize: 24, fontWeight: "700" }}>Rejser</Text>
        </View>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button
            label="Tilslut"
            icon="enter-outline"
            variant="secondary"
            onPress={() => router.push("/trip/join")}
            accessibilityHint="Tilslut en grupperejse med en invitationskode"
          />
          <Button label="Ny rejse" icon="add" onPress={() => router.push("/trip/new")} />
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: space.xxl }} />
      ) : trips.length === 0 ? (
        <EmptyState
          icon="airplane-outline"
          title="Ingen rejser endnu"
          message="Opret en rejse med navn, land og datoer. Det virker også uden internet. Har du fået en invitationskode, så tryk på Tilslut."
        />
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, maxWidth: 720, width: "100%", alignSelf: "center" }}
          ListHeaderComponent={
            // Tidslinje, galleri og kort for alle rejser på én gang. Med én rejse er det det samme.
            trips.length > 1 ? (
              <Pressable
                onPress={() => choose(ALL_TRIPS)}
                accessibilityRole="button"
                accessibilityState={{ selected: showAll }}
                accessibilityHint="Vis indlæg fra alle rejser i tidslinjen, galleriet og på kortet"
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  padding: space.lg,
                  borderRadius: radius.lg,
                  borderCurve: "continuous",
                  borderWidth: showAll ? 2 : 1,
                  borderColor: showAll ? p.ink : p.border,
                  backgroundColor: pressed ? p.surfaceMuted : p.surface,
                })}
              >
                <View style={{ width: 40, alignItems: "center" }}>
                  <Ionicons name="earth-outline" size={30} color={p.text} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: p.text, fontSize: 18, fontWeight: "700" }}>Alle rejser</Text>
                  <Text style={{ color: p.textMuted, fontSize: 14 }} numberOfLines={1}>
                    {allTripsSummary(trips)}
                  </Text>
                  <Text style={{ color: p.textMuted, fontSize: 13 }}>{totalPosts} indlæg</Text>
                </View>
                {showAll ? <Ionicons name="checkmark-circle" size={24} color={p.ink} /> : null}
              </Pressable>
            ) : undefined
          }
          renderItem={({ item }) => {
            const isActive = item.id === active?.id;
            const n = counts.data?.[item.id] ?? 0;
            return (
              <Pressable
                onPress={() => choose(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityHint="Vis rejsens tidslinje"
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  padding: space.lg,
                  borderRadius: radius.lg,
                  borderCurve: "continuous",
                  borderWidth: isActive ? 2 : 1,
                  borderColor: isActive ? p.ink : p.border,
                  backgroundColor: pressed ? p.surfaceMuted : p.surface,
                })}
              >
                <Text style={{ fontSize: 32 }}>{flagEmoji(item.countryCode)}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: p.text, fontSize: 18, fontWeight: "700" }} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={{ color: p.textMuted, fontSize: 14 }}>
                    {countryName(item.countryCode)} · {formatDateRange(item.startDate, item.endDate)}
                  </Text>
                  <Text style={{ color: p.textMuted, fontSize: 13 }}>
                    {n} indlæg
                    {item.memberCount > 1 ? ` · ${item.memberCount} i gruppen` : ""}
                    {item.syncStatus !== "synkroniseret" ? " · kun på telefonen" : ""}
                  </Text>
                </View>
                {/* Gruppen: hvem der er med, og (for ejeren) invitér flere. */}
                <Pressable
                  onPress={() => router.push({ pathname: "/trip/members/[id]", params: { id: item.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Gruppen på ${item.name}`}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? p.surfaceMuted : "transparent",
                  })}
                >
                  <Ionicons
                    name={item.memberCount > 1 ? "people-outline" : "person-add-outline"}
                    size={22}
                    color={p.text}
                  />
                </Pressable>
                {isActive ? <Ionicons name="checkmark-circle" size={24} color={p.ink} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
