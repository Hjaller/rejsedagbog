import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useLocalDb } from "@/lib/local-db/provider";
import { usePendingCount } from "@/lib/local-db/queries";
import { MIN_TOUCH, usePalette } from "@/lib/theme";

/**
 * Avatar med brugerens forbogstav, der åbner Profil (redesign D: profilen ligger i
 * headeren i stedet for en fane). En rød prik viser, at noget venter på upload.
 */
export function ProfileButton() {
  const p = usePalette();
  const router = useRouter();
  const { user } = useLocalDb();
  const pending = usePendingCount();
  const waiting = (pending.data ?? 0) > 0;
  const initial = (user.name.trim()[0] ?? "?").toUpperCase();
  return (
    <Pressable
      onPress={() => router.push("/profile")}
      accessibilityRole="button"
      accessibilityLabel={waiting ? `Profil. ${pending.data} venter på upload` : "Profil"}
      style={({ pressed }) => ({
        width: MIN_TOUCH,
        height: MIN_TOUCH,
        borderRadius: MIN_TOUCH / 2,
        borderWidth: 1.5,
        borderColor: p.ink,
        backgroundColor: pressed ? p.surfaceMuted : p.surface,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <Text style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{initial}</Text>
      {waiting ? (
        <View
          style={{
            position: "absolute",
            top: -1,
            right: -1,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: p.accent,
            borderWidth: 2,
            borderColor: p.background,
          }}
        />
      ) : null}
    </Pressable>
  );
}
