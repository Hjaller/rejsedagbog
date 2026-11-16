import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { authClient } from "@/lib/auth-client";
import { useLocalDb } from "@/lib/local-db/provider";
import { formatRelative } from "@/lib/dates";
import { usePendingCount, useTrips } from "@/lib/local-db/queries";
import { requestSync, useSyncState } from "@/lib/sync/sync-scheduler";
import { radius, space, usePalette } from "@/lib/theme";
import { queryClient } from "@/utils/trpc";

export default function ProfileScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { user } = useLocalDb();
  const pending = usePendingCount();
  const trips = useTrips();
  const [signingOut, setSigningOut] = useState(false);
  const sync = useSyncState();

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
    const n = pending.data ?? 0;
    if (n === 0) {
      void signOut();
      return;
    }
    Alert.alert(
      "Log ud?",
      `${n} indlæg er ikke uploadet endnu. De bliver liggende på telefonen og uploades, når du logger ind igen.`,
      [
        { text: "Annullér", style: "cancel" },
        { text: "Log ud", style: "destructive", onPress: () => void signOut() },
      ],
    );
  };

  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: insets.top + space.lg,
        paddingHorizontal: space.lg,
        paddingBottom: space.xxl,
        gap: space.lg,
        maxWidth: 560,
        width: "100%",
        alignSelf: "center",
      }}
    >
      <View style={{ gap: space.xs }}>
        <Text style={{ color: p.textMuted, fontSize: 12, letterSpacing: 1.2 }}>PROFIL</Text>
        <Text selectable style={{ color: p.text, fontSize: 26, fontWeight: "700" }}>
          {user.name}
        </Text>
        <Text selectable style={{ color: p.textMuted, fontSize: 16 }}>
          {user.email}
        </Text>
      </View>

      <View
        style={{
          backgroundColor: p.surface,
          borderWidth: 1,
          borderColor: p.border,
          borderRadius: radius.lg,
          padding: space.lg,
          gap: space.sm,
        }}
      >
        <Stat label="Rejser" value={trips.data?.length ?? 0} />
        <Stat label="Venter på upload" value={pending.data ?? 0} />
        <Text selectable style={{ color: sync.lastError ? p.danger : p.textMuted, fontSize: 14 }}>
          {sync.running
            ? "Synkroniserer …"
            : sync.offline
              ? "Ingen forbindelse – uploades automatisk, når du er online."
              : sync.lastError
                ? sync.lastError
                : sync.lastSyncAt
                  ? `Sidst synkroniseret ${formatRelative(sync.lastSyncAt)}`
                  : "Ikke synkroniseret endnu"}
        </Text>
        <Button
          label="Synkronisér nu"
          variant="secondary"
          icon="sync-outline"
          loading={sync.running}
          onPress={() => void requestSync({ pull: true, ignoreBackoff: true })}
        />
      </View>

      <Button label="Log ud" variant="danger" icon="log-out-outline" onPress={confirmSignOut} loading={signingOut} />
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={{ color: p.textMuted, fontSize: 16 }}>{label}</Text>
      <Text style={{ color: p.text, fontSize: 16, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}
