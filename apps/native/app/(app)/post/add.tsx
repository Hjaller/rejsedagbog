import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { useActiveTrip } from "@/lib/local-db/queries";
import { ALBUM_LIMIT } from "@/lib/media";
import { radius, space, typo, usePalette } from "@/lib/theme";

/**
 * "+" åbner dette ark: tag et billede med telefonens kamera, eller vælg et eller
 * flere fra albummet. Begge dele gemmes med det samme på opret-skærmen.
 */
export default function NewPostSheet() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { defaultTrip, isLoading } = useActiveTrip();

  const open = (source: "camera" | "album") => router.replace({ pathname: "/post/new", params: { source } });

  return (
    <View
      style={{
        backgroundColor: p.surface,
        paddingHorizontal: space.lg,
        paddingTop: space.lg,
        paddingBottom: Math.max(insets.bottom, space.lg),
        gap: space.md,
      }}
    >
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={[typo.title, { color: p.text }]}>
          Nyt indlæg
        </Text>
        {defaultTrip ? (
          <Text style={{ color: p.textMuted, fontSize: 14 }} numberOfLines={1}>
            Gemmes i <Text style={{ color: p.text, fontWeight: "600" }}>{defaultTrip.name}</Text> · kan skiftes
            bagefter
          </Text>
        ) : null}
      </View>

      {!isLoading && !defaultTrip ? (
        <View style={{ gap: space.md }}>
          <Text style={{ color: p.textMuted, fontSize: 15, lineHeight: 21 }}>
            Indlæg hører til en rejse. Opret en rejse først, eller tilslut en grupperejse med en kode.
          </Text>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Button
              label="Tilslut med kode"
              variant="secondary"
              onPress={() => router.replace("/trip/join")}
              style={{ flex: 1 }}
            />
            <Button label="Ny rejse" icon="add" onPress={() => router.replace("/trip/new")} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Choice
            icon="camera"
            title="Tag et billede"
            subtitle="Åbner telefonens kamera"
            filled
            onPress={() => open("camera")}
          />
          <Choice
            icon="images-outline"
            title="Vælg fra album"
            subtitle={`Et eller flere billeder, op til ${ALBUM_LIMIT} ad gangen`}
            onPress={() => open("album")}
          />
        </View>
      )}
    </View>
  );
}

function Choice({
  icon,
  title,
  subtitle,
  filled,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  filled?: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: 72,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: p.border,
        backgroundColor: pressed ? p.surfaceMuted : p.surface,
      })}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: filled ? p.accent : "transparent",
          borderWidth: filled ? 0 : 1.5,
          borderColor: p.accent,
        }}
      >
        <Ionicons name={icon} size={24} color={filled ? p.onAccent : p.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[typo.heading, { color: p.text, fontSize: 18, lineHeight: 23 }]}>{title}</Text>
        <Text style={{ color: p.textMuted, fontSize: 13 }}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={p.textMuted} />
    </Pressable>
  );
}
