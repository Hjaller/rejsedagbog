import { countryName, flagEmoji } from "@rejsedagbog/shared";
import { Link } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PendingPill } from "@/components/sync-status";
import { formatDateRange } from "@/lib/dates";
import type { LocalTrip } from "@/lib/local-db/repo";
import { space, usePalette } from "@/lib/theme";

/**
 * Header fra wireframes: lille overskrift, rejsens navn med ▾ (skift rejse),
 * "N venter på upload" og en linje med land, datoer og gruppe.
 */
export function TripHeader({
  eyebrow,
  trip,
  pendingCount,
  right,
}: {
  eyebrow: string;
  trip: LocalTrip | null;
  pendingCount: number;
  right?: ReactNode;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: p.surface, borderBottomWidth: 1, borderBottomColor: p.border }}>
      <View
        style={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg,
          paddingBottom: space.md,
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: space.md,
        }}
      >
        <View style={{ flexShrink: 1 }}>
          <Text style={{ color: p.textMuted, fontSize: 12, letterSpacing: 1.2 }}>{eyebrow}</Text>
          <Link href="/trips" asChild>
            <Pressable accessibilityRole="button" accessibilityHint="Skift rejse" hitSlop={8}>
              <Text numberOfLines={1} style={{ color: p.text, fontSize: 24, fontWeight: "700" }}>
                {trip ? `${trip.name} ▾` : "Ingen rejse"}
              </Text>
            </Pressable>
          </Link>
        </View>
        {right ?? <PendingPill count={pendingCount} />}
      </View>
      {trip ? (
        <View
          style={{
            backgroundColor: p.surfaceMuted,
            paddingHorizontal: space.lg,
            paddingVertical: space.sm + 2,
            flexDirection: "row",
            justifyContent: "space-between",
            gap: space.md,
          }}
        >
          <Text style={{ color: p.textMuted, fontSize: 14 }} numberOfLines={1}>
            {flagEmoji(trip.countryCode)} {countryName(trip.countryCode)} ·{" "}
            {formatDateRange(trip.startDate, trip.endDate)}
          </Text>
          {trip.memberCount > 1 ? (
            <Text style={{ color: p.textMuted, fontSize: 14 }}>{trip.memberCount} i gruppen</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
