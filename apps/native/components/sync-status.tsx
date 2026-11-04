import Ionicons from "@expo/vector-icons/Ionicons";
import type { SyncStatus } from "@rejsedagbog/shared";
import { Text, View } from "react-native";

import { radius, space, usePalette } from "@/lib/theme";

const LABELS: Record<SyncStatus, string> = {
  lokal: "gemt lokalt · venter på upload",
  uploader: "uploader …",
  synkroniseret: "uploadet",
  fejl: "upload fejlede · prøver igen",
};

const ICONS: Record<SyncStatus, "cloud-offline-outline" | "cloud-upload-outline" | "cloud-done-outline" | "alert-circle-outline"> = {
  lokal: "cloud-offline-outline",
  uploader: "cloud-upload-outline",
  synkroniseret: "cloud-done-outline",
  fejl: "alert-circle-outline",
};

export function syncLabel(status: SyncStatus): string {
  return LABELS[status];
}

/** Ikon, der viser om indlægget er uploadet (kravspec: brugervenlighed). */
export function SyncIcon({ status, size = 14 }: { status: SyncStatus; size?: number }) {
  const p = usePalette();
  const color =
    status === "synkroniseret" ? p.success : status === "fejl" ? p.danger : p.warning;
  return (
    <Ionicons
      name={ICONS[status]}
      size={size}
      color={color}
      accessibilityLabel={LABELS[status]}
    />
  );
}

/** "● 1 venter på upload" i headeren. Skjules, når alt er uploadet. */
export function PendingPill({ count }: { count: number }) {
  const p = usePalette();
  if (count <= 0) return null;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${count} indlæg venter på upload`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs + 2,
        borderWidth: 1,
        borderColor: p.borderStrong,
        borderRadius: radius.pill,
        paddingHorizontal: space.md,
        paddingVertical: space.xs + 1,
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: p.accent }} />
      <Text style={{ color: p.text, fontSize: 13, fontVariant: ["tabular-nums"] }}>
        {count} venter på upload
      </Text>
    </View>
  );
}
