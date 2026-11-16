import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { formatRelative } from "@/lib/dates";
import { useLocalDb } from "@/lib/local-db/provider";
import { useTrips } from "@/lib/local-db/queries";
import { radius, space, usePalette } from "@/lib/theme";
import { useTripMembers, type TripMember } from "@/lib/trip-members";

/** Hvem der er med på rejsen (grupperejser). Ejeren kan herfra invitere flere. */
export default function MembersScreen() {
  const p = usePalette();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useLocalDb();
  const trips = useTrips();
  const trip = trips.data?.find((t) => t.id === id);
  const members = useTripMembers(trip);

  if (trips.isLoading) return <ActivityIndicator style={{ marginTop: space.xxl }} />;
  if (!trip) return <EmptyState icon="people-outline" title="Rejsen findes ikke på telefonen" />;

  const list = members.data?.members ?? [];
  const isOwner = trip.role === "owner";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: p.background }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 560, width: "100%", alignSelf: "center" }}
      refreshControl={<RefreshControl refreshing={members.isRefetching} onRefresh={() => void members.refetch()} />}
    >
      <View style={{ gap: space.xs }}>
        <Text style={{ color: p.text, fontSize: 22, fontWeight: "700" }}>{trip.name}</Text>
        <Text style={{ color: p.textMuted, fontSize: 15 }}>
          {members.data
            ? list.length === 1
              ? "Kun dig indtil videre"
              : `${list.length} i gruppen`
            : trip.memberCount === 1
              ? "Kun dig indtil videre"
              : `${trip.memberCount} i gruppen`}
        </Text>
      </View>

      {members.isLoading ? <ActivityIndicator /> : null}

      {members.error ? (
        <Text selectable accessibilityRole="alert" style={{ color: p.danger, fontSize: 15 }}>
          {members.error.message}
        </Text>
      ) : null}

      {list.length > 0 ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: p.border,
            borderRadius: radius.lg,
            borderCurve: "continuous",
            backgroundColor: p.surface,
            overflow: "hidden",
          }}
        >
          {list.map((m, i) => (
            <MemberRow key={m.id} member={m} isYou={m.id === user.id} last={i === list.length - 1} />
          ))}
        </View>
      ) : null}

      {members.data?.offlineMessage ? (
        <Text style={{ color: p.textMuted, fontSize: 14 }}>
          {members.data.offlineMessage}
          {members.data.fetchedAt ? ` Hentet ${formatRelative(members.data.fetchedAt)}.` : ""}
        </Text>
      ) : null}

      {trip.syncStatus !== "synkroniseret" ? (
        <Text style={{ color: p.textMuted, fontSize: 15, lineHeight: 21 }}>
          Rejsen er kun på telefonen indtil videre. Når den er uploadet, kan du invitere andre.
        </Text>
      ) : isOwner ? (
        <Button
          label={trip.inviteCode ? "Vis invitationskode" : "Invitér flere"}
          icon="person-add-outline"
          variant={list.length > 1 ? "secondary" : "primary"}
          onPress={() => router.push({ pathname: "/trip/invite/[id]", params: { id: trip.id } })}
        />
      ) : (
        <Text style={{ color: p.textMuted, fontSize: 15, lineHeight: 21 }}>
          Kun rejsens ejer kan invitere flere.
        </Text>
      )}
    </ScrollView>
  );
}

function MemberRow({ member, isYou, last }: { member: TripMember; isYou: boolean; last: boolean }) {
  const p = usePalette();
  const initial = member.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <View
      accessible
      accessibilityLabel={`${member.name}${isYou ? ", dig" : ""}${member.role === "owner" ? ", ejer" : ""}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: p.border,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isYou ? p.ink : p.surfaceMuted,
        }}
      >
        <Text style={{ color: isYou ? p.onInk : p.text, fontSize: 17, fontWeight: "700" }}>{initial}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: p.text, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
          {member.name}
          {isYou ? <Text style={{ color: p.textMuted, fontWeight: "400" }}> (dig)</Text> : null}
        </Text>
        <Text style={{ color: p.textMuted, fontSize: 13 }}>
          {member.role === "owner" ? "Har oprettet rejsen" : `Med siden ${formatRelative(member.joinedAt)}`}
        </Text>
      </View>
      {member.role === "owner" ? (
        <View
          style={{
            paddingHorizontal: space.sm,
            paddingVertical: 2,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: p.borderStrong,
          }}
        >
          <Text style={{ color: p.textMuted, fontSize: 12 }}>Ejer</Text>
        </View>
      ) : null}
    </View>
  );
}
