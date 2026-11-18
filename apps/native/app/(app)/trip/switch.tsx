import Ionicons from "@expo/vector-icons/Ionicons";
import { flagEmoji } from "@rejsedagbog/shared";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { allTripsSummary } from "@/components/trip-header";
import { formatDateRange, tripDay } from "@/lib/dates";
import { ALL_TRIPS, useActiveTrip, usePostCounts } from "@/lib/local-db/queries";
import type { LocalTrip } from "@/lib/local-db/repo";
import { radius, space, typo, usePalette } from "@/lib/theme";

/** Flere rejser end det her vises i Rejser-fanen, så arket ikke skal kunne rulle. */
const MAX_TRIPS = 5;

/**
 * Skift rejse (redesign D3). Åbnes fra rejsens navn i headeren som et ark over den
 * skærm, man står på, så man bliver i tidslinjen, galleriet eller på kortet.
 */
export default function TripSwitchSheet() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trip: active, showAll, trips, setActiveTrip } = useActiveTrip();
  const counts = usePostCounts();
  const total = trips.reduce((sum, t) => sum + (counts.data?.[t.id] ?? 0), 0);

  const choose = async (tripId: string) => {
    await setActiveTrip(tripId);
    router.back();
  };

  const subtitle = (t: LocalTrip) => {
    const n = counts.data?.[t.id] ?? 0;
    const day = tripDay(t.startDate, t.endDate, new Date());
    const when = day ? `I gang · dag ${day.day} af ${day.total}` : formatDateRange(t.startDate, t.endDate);
    const local = t.syncStatus !== "synkroniseret" ? " · kun på telefonen" : "";
    const shared = t.role === "viewer" ? " · kun visning" : "";
    return `${when} · ${n} indlæg${local}${shared}`;
  };

  return (
    <View
      style={{
        backgroundColor: p.surface,
        paddingHorizontal: space.lg,
        paddingTop: space.lg,
        paddingBottom: Math.max(insets.bottom, space.lg),
        gap: space.sm,
      }}
    >
      <Text accessibilityRole="header" style={[typo.title, { color: p.text, marginBottom: space.xs }]}>
        Vis rejse
      </Text>

      {trips.length === 0 ? (
        <Text style={{ color: p.textMuted, fontSize: 15, paddingVertical: space.md }}>
          Du har ingen rejser endnu. Opret en, eller tilslut en grupperejse med en kode.
        </Text>
      ) : (
        <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
          {trips.slice(0, MAX_TRIPS).map((t) => (
            <Option
              key={t.id}
              selected={!showAll && t.id === active?.id}
              onPress={() => choose(t.id)}
              icon={<Text style={{ fontSize: 26 }}>{flagEmoji(t.countryCodes[0] ?? "")}</Text>}
              title={t.name}
              subtitle={subtitle(t)}
            />
          ))}
          {trips.length > 1 ? (
            <Option
              selected={showAll}
              onPress={() => choose(ALL_TRIPS)}
              icon={<Ionicons name="earth-outline" size={26} color={p.text} />}
              title="Alle rejser"
              subtitle={`${allTripsSummary(trips)} · ${total} indlæg`}
            />
          ) : null}
          {trips.length > MAX_TRIPS ? (
            <Button
              label={`Se alle ${trips.length} rejser`}
              variant="ghost"
              onPress={() => router.replace("/trips")}
            />
          ) : null}
        </View>
      )}

      <View style={{ flexDirection: "row", gap: space.md, marginTop: space.sm }}>
        <Button
          label="Tilslut med kode"
          variant="secondary"
          onPress={() => router.replace("/trip/join")}
          style={{ flex: 1 }}
        />
        <Button label="Ny rejse" icon="add" onPress={() => router.replace("/trip/new")} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function Option({
  selected,
  onPress,
  icon,
  title,
  subtitle,
}: {
  selected: boolean;
  onPress: () => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: 64,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? p.ink : p.border,
        backgroundColor: pressed ? p.surfaceMuted : p.surface,
      })}
    >
      <View style={{ width: 36, alignItems: "center" }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: p.text, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ color: p.textMuted, fontSize: 13 }} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Ionicons
        name={selected ? "checkmark-circle" : "ellipse-outline"}
        size={24}
        color={selected ? p.ink : p.borderStrong}
      />
    </Pressable>
  );
}
