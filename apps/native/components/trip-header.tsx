import Ionicons from "@expo/vector-icons/Ionicons";
import { countryName, flagEmoji, flagEmojis } from "@rejsedagbog/shared";
import { Link } from "expo-router";
import { useMemo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProfileButton } from "@/components/profile-button";
import { PendingPill } from "@/components/sync-status";
import { formatDateRange } from "@/lib/dates";
import type { LocalTrip } from "@/lib/local-db/repo";
import { radius, space, typo, usePalette } from "@/lib/theme";

/**
 * "🇯🇵 Japan 2026" pr. rejse-id til indlæggene, når alle rejser vises sammen;
 * null for én rejse, hvor rejsens navn allerede står i headeren.
 */
export function useTripLabel(trips: LocalTrip[], showAll: boolean): (post: { tripId: string }) => string | null {
  const labels = useMemo(
    () => new Map(trips.map((t) => [t.id, `${flagEmojis(t.countryCodes, 2)} ${t.name}`])),
    [trips],
  );
  return (post) => (showAll ? (labels.get(post.tripId) ?? null) : null);
}

/** "🇩🇰 🇯🇵 · 3 rejser i 2 lande" til headeren, når alle rejser vises. */
export function allTripsSummary(trips: LocalTrip[]): string {
  const countries = [...new Set(trips.flatMap((t) => t.countryCodes))];
  const flags = countries.slice(0, 8).map(flagEmoji).join(" ");
  const tripWord = trips.length === 1 ? "rejse" : "rejser";
  const countryWord = countries.length === 1 ? "land" : "lande";
  return `${flags}${countries.length > 8 ? " …" : ""} · ${trips.length} ${tripWord} i ${countries.length} ${countryWord}`;
}

/** Landekoden som et lille stempel ("JP"). */
export function CountryTag({ code }: { code: string | null }) {
  const p = usePalette();
  if (!code) return null;
  return (
    <View
      accessibilityLabel={countryName(code)}
      style={{ borderWidth: 1.5, borderColor: p.accentText, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 }}
    >
      <Text style={[typo.eyebrow, { color: p.accentText, letterSpacing: 1 }]}>{code.toUpperCase()}</Text>
    </View>
  );
}

/** En rundrejses lande som stempler: højst tre, resten som "+2". */
export function CountryTags({ codes }: { codes: string[] }) {
  const p = usePalette();
  const MAX = 3;
  return (
    <>
      {codes.slice(0, MAX).map((code) => (
        <CountryTag key={code} code={code} />
      ))}
      {codes.length > MAX ? (
        <Text
          accessibilityLabel={`og ${codes.slice(MAX).map(countryName).join(", ")}`}
          style={[typo.eyebrow, { color: p.accentText, letterSpacing: 1 }]}
        >
          +{codes.length - MAX}
        </Text>
      ) : null}
    </>
  );
}

/**
 * Fanernes header (redesign D): lille versal-etiket, rejsens navn i serif med ▾
 * (åbner rejsearket), profil-avatar og en linje med land, datoer, gruppe og upload.
 * Med `allTrips` vises "Alle rejser" og en linje med lande og antal rejser.
 */
export function TripHeader({
  eyebrow,
  trip,
  allTrips,
  pendingCount,
  meta,
}: {
  eyebrow: string;
  trip: LocalTrip | null;
  /** Rejserne, når "Alle rejser" er valgt. */
  allTrips?: LocalTrip[] | null;
  pendingCount: number;
  /** Kort tal for skærmen ("42 billeder"), vist når intet venter på upload. */
  meta?: ReactNode;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const title = allTrips ? "Alle rejser" : trip ? trip.name : null;
  return (
    <View
      style={{
        backgroundColor: p.background,
        paddingTop: insets.top + space.md,
        paddingHorizontal: space.lg,
        paddingBottom: space.md,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: space.md }}>
        <View style={{ flexShrink: 1, gap: 2 }}>
          <Text style={[typo.eyebrow, { color: p.textMuted }]}>{eyebrow}</Text>
          <Link href="/trip/switch" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={title ? `${title}. Skift rejse` : "Vælg rejse"}
              hitSlop={8}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.6 : 1 })}
            >
              <Text numberOfLines={1} style={[typo.hero, { color: p.text, flexShrink: 1 }]}>
                {title ?? "Ingen rejse"}
              </Text>
              <Ionicons name="chevron-down" size={22} color={p.text} />
            </Pressable>
          </Link>
        </View>
        <ProfileButton />
      </View>

      {allTrips || trip ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 28 }}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
            {allTrips ? (
              <Text style={{ color: p.textMuted, fontSize: 14 }} numberOfLines={1}>
                {allTripsSummary(allTrips)}
              </Text>
            ) : trip ? (
              <>
                <CountryTags codes={trip.countryCodes} />
                <Text style={{ color: p.textMuted, fontSize: 14 }}>{formatDateRange(trip.startDate, trip.endDate)}</Text>
                {trip.role === "viewer" ? (
                  // Rejsen er delt med brugeren: der kan ses, men ikke lægges op.
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="eye-outline" size={15} color={p.textMuted} />
                    <Text style={{ color: p.textMuted, fontSize: 14 }}>Kun visning</Text>
                  </View>
                ) : null}
                {trip.memberCount > 1 ? (
                  <Link href={{ pathname: "/trip/members/[id]", params: { id: trip.id } }} asChild>
                    <Pressable accessibilityRole="button" accessibilityHint="Se hvem der er med" hitSlop={8}>
                      <Text style={{ color: p.text, fontSize: 14, textDecorationLine: "underline" }}>
                        {trip.memberCount} i gruppen
                      </Text>
                    </Pressable>
                  </Link>
                ) : null}
              </>
            ) : null}
          </View>
          {pendingCount > 0 ? (
            <PendingPill count={pendingCount} />
          ) : typeof meta === "string" ? (
            <Text style={{ color: p.textMuted, fontSize: 14, fontVariant: ["tabular-nums"] }}>{meta}</Text>
          ) : (
            (meta ?? null)
          )}
        </View>
      ) : null}
    </View>
  );
}

/** Dag-overskrift i tidslinje og galleri: "Dag 5  tirsdag 14. april ———". */
export function DayHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  const p = usePalette();
  return (
    <View
      accessibilityRole="header"
      style={{ flexDirection: "row", alignItems: "center", gap: space.sm + 2, paddingTop: space.md, paddingBottom: space.xs }}
    >
      <Text style={[typo.heading, { color: p.text }]}>{title}</Text>
      {subtitle ? <Text style={{ color: p.textMuted, fontSize: 13 }}>{subtitle}</Text> : null}
      <View style={{ flex: 1, height: 1, backgroundColor: p.border, borderRadius: radius.pill }} />
    </View>
  );
}
