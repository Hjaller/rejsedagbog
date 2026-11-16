import { countryName, flagEmoji } from "@rejsedagbog/shared";
import { Link } from "expo-router";
import { useMemo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PendingPill } from "@/components/sync-status";
import { formatDateRange } from "@/lib/dates";
import type { LocalTrip } from "@/lib/local-db/repo";
import { space, usePalette } from "@/lib/theme";

/**
 * "🇯🇵 Japan 2026" pr. rejse-id til indlæggene, når alle rejser vises sammen;
 * null for én rejse, hvor rejsens navn allerede står i headeren.
 */
export function useTripLabel(trips: LocalTrip[], showAll: boolean): (post: { tripId: string }) => string | null {
  const labels = useMemo(
    () => new Map(trips.map((t) => [t.id, `${flagEmoji(t.countryCode)} ${t.name}`])),
    [trips],
  );
  return (post) => (showAll ? (labels.get(post.tripId) ?? null) : null);
}

/** "🇩🇰 🇯🇵 · 3 rejser i 2 lande" til headeren, når alle rejser vises. */
export function allTripsSummary(trips: LocalTrip[]): string {
  const countries = [...new Set(trips.map((t) => t.countryCode))];
  const flags = countries.slice(0, 8).map(flagEmoji).join(" ");
  const tripWord = trips.length === 1 ? "rejse" : "rejser";
  const countryWord = countries.length === 1 ? "land" : "lande";
  return `${flags}${countries.length > 8 ? " …" : ""} · ${trips.length} ${tripWord} i ${countries.length} ${countryWord}`;
}

/**
 * Header fra wireframes: lille overskrift, rejsens navn med ▾ (skift rejse),
 * "N venter på upload" og en linje med land, datoer og gruppe.
 * Med `allTrips` vises "Alle rejser" og en linje med lande og antal rejser.
 */
export function TripHeader({
  eyebrow,
  trip,
  allTrips,
  pendingCount,
  right,
}: {
  eyebrow: string;
  trip: LocalTrip | null;
  /** Rejserne, når "Alle rejser" er valgt. */
  allTrips?: LocalTrip[] | null;
  pendingCount: number;
  right?: ReactNode;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const title = allTrips ? "Alle rejser" : trip ? trip.name : null;
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
                {title ? `${title} ▾` : "Ingen rejse"}
              </Text>
            </Pressable>
          </Link>
        </View>
        {right ?? <PendingPill count={pendingCount} />}
      </View>
      {allTrips ? (
        <View style={{ backgroundColor: p.surfaceMuted, paddingHorizontal: space.lg, paddingVertical: space.sm + 2 }}>
          <Text style={{ color: p.textMuted, fontSize: 14 }} numberOfLines={1}>
            {allTripsSummary(allTrips)}
          </Text>
        </View>
      ) : trip ? (
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
            <Link href={{ pathname: "/trip/members/[id]", params: { id: trip.id } }} asChild>
              <Pressable accessibilityRole="button" accessibilityHint="Se hvem der er med" hitSlop={8}>
                <Text style={{ color: p.text, fontSize: 14, textDecorationLine: "underline" }}>
                  {trip.memberCount} i gruppen
                </Text>
              </Pressable>
            </Link>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
