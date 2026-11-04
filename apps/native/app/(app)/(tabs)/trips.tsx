import Ionicons from "@expo/vector-icons/Ionicons";
import { countryName, flagEmoji } from "@rejsedagbog/shared";
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { formatDateRange } from "@/lib/dates";
import { useActiveTrip, usePostCounts } from "@/lib/local-db/queries";
import type { LocalTrip } from "@/lib/local-db/repo";
import { radius, space, usePalette } from "@/lib/theme";

export default function TripsScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trip: active, trips, setActiveTrip, isLoading } = useActiveTrip();
  const counts = usePostCounts();

  const choose = async (trip: LocalTrip) => {
    await setActiveTrip(trip.id);
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
        <Button label="Ny rejse" icon="add" onPress={() => router.push("/trip/new")} />
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: space.xxl }} />
      ) : trips.length === 0 ? (
        <EmptyState
          icon="airplane-outline"
          title="Ingen rejser endnu"
          message="Opret en rejse med navn, land og datoer. Det virker også uden internet."
        />
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: space.lg, gap: space.md, maxWidth: 720, width: "100%", alignSelf: "center" }}
          renderItem={({ item }) => {
            const isActive = item.id === active?.id;
            const n = counts.data?.[item.id] ?? 0;
            return (
              <Pressable
                onPress={() => choose(item)}
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
                {isActive ? <Ionicons name="checkmark-circle" size={24} color={p.ink} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
