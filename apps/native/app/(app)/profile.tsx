import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { authClient } from "@/lib/auth-client";
import { formatRelative } from "@/lib/dates";
import { useLocalDb } from "@/lib/local-db/provider";
import { usePendingCount, usePostCounts, useTrips } from "@/lib/local-db/queries";
import { requestSync, useSyncState } from "@/lib/sync/sync-scheduler";
import { radius, space, typo, usePalette } from "@/lib/theme";
import { queryClient } from "@/utils/trpc";

/** Profil (åbnes fra avataren i headeren): upload-status, synkronisering og log ud. */
export default function ProfileScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useLocalDb();
  const pending = usePendingCount();
  const trips = useTrips();
  const counts = usePostCounts();
  const [signingOut, setSigningOut] = useState(false);
  const sync = useSyncState();

  const waiting = pending.data ?? 0;
  const tripList = trips.data ?? [];
  const postTotal = Object.values(counts.data ?? {}).reduce((a, b) => a + b, 0);
  const countries = new Set(tripList.map((t) => t.countryCode)).size;

  const signOut = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      queryClient.clear();
      setSigningOut(false);
    }
  };

  const confirmSignOut = () => {
    if (waiting === 0) {
      void signOut();
      return;
    }
    Alert.alert(
      "Log ud?",
      `${waiting} indlæg er ikke sendt endnu. De bliver liggende på telefonen og sendes, når du logger ind igen.`,
      [
        { text: "Annullér", style: "cancel" },
        { text: "Log ud", style: "destructive", onPress: () => void signOut() },
      ],
    );
  };

  const status = sync.running
    ? "Sender og henter …"
    : sync.offline
      ? "Du er offline. Indlæggene ligger sikkert på telefonen og sendes af sig selv, når du får net."
      : sync.lastError
        ? sync.lastError
        : sync.lastSyncAt
          ? `Sidst opdateret ${formatRelative(sync.lastSyncAt)}`
          : "Ikke opdateret endnu";

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: insets.bottom + space.xxl,
        gap: space.lg,
        maxWidth: 560,
        width: "100%",
        alignSelf: "center",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: p.ink,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={[typo.title, { color: p.onInk }]}>{(user.name.trim()[0] ?? "?").toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text selectable style={[typo.title, { color: p.text }]} numberOfLines={1}>
            {user.name}
          </Text>
          <Text selectable style={{ color: p.textMuted, fontSize: 15 }} numberOfLines={1}>
            {user.email}
          </Text>
        </View>
      </View>

      <View
        style={{
          backgroundColor: p.ink,
          borderRadius: radius.sm,
          padding: space.lg,
          flexDirection: "row",
          gap: space.sm,
        }}
      >
        <Stat value={tripList.length} label={tripList.length === 1 ? "rejse" : "rejser"} />
        <Stat value={countries} label={countries === 1 ? "land" : "lande"} />
        <Stat value={postTotal} label="indlæg" />
      </View>

      {/* Upload: det vigtigste at kunne se på en rejse uden fast net */}
      <View
        style={{
          backgroundColor: p.surface,
          borderWidth: 1,
          borderStyle: waiting > 0 ? "dashed" : "solid",
          borderColor: waiting > 0 ? p.accent : p.border,
          borderRadius: radius.md,
          padding: space.lg,
          gap: space.md,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <Ionicons
            name={waiting > 0 ? (sync.offline ? "cloud-offline-outline" : "cloud-upload-outline") : "cloud-done-outline"}
            size={28}
            color={waiting > 0 ? p.accent : p.success}
          />
          <Text accessibilityRole="header" style={[typo.heading, { color: p.text, flex: 1 }]}>
            {waiting > 0 ? `${waiting} venter på at blive sendt` : "Alt er sendt"}
          </Text>
        </View>
        <Text selectable style={{ color: sync.lastError ? p.danger : p.textMuted, fontSize: 14, lineHeight: 20 }}>
          {status}
        </Text>
        <Button
          label={waiting > 0 ? "Prøv at sende nu" : "Hent nyt fra gruppen"}
          variant="secondary"
          icon="sync-outline"
          loading={sync.running}
          onPress={() => void requestSync({ pull: true, ignoreBackoff: true })}
        />
      </View>

      <View style={{ backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, borderRadius: radius.md }}>
        <Row icon="enter-outline" label="Tilslut rejse med kode" onPress={() => router.push("/trip/join")} />
        <Row icon="add-circle-outline" label="Ny rejse" onPress={() => router.push("/trip/new")} last />
      </View>

      <Button label="Log ud" variant="danger" icon="log-out-outline" onPress={confirmSignOut} loading={signingOut} />
    </ScrollView>
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

function Row({
  icon,
  label,
  onPress,
  last,
}: {
  icon: "enter-outline" | "add-circle-outline";
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: 52,
        paddingHorizontal: space.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: p.border,
        backgroundColor: pressed ? p.surfaceMuted : "transparent",
      })}
    >
      <Ionicons name={icon} size={22} color={p.text} />
      <Text style={{ flex: 1, color: p.text, fontSize: 16 }}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={p.textMuted} />
    </Pressable>
  );
}
