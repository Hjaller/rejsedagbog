import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { Text, View } from "react-native";

import { space, usePalette } from "@/lib/theme";

export function EmptyState({
  icon,
  title,
  message,
  children,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  message?: string;
  children?: ReactNode;
}) {
  const p = usePalette();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: space.xxl,
        gap: space.md,
      }}
    >
      <Ionicons name={icon} size={40} color={p.textMuted} />
      <Text style={{ color: p.text, fontSize: 18, fontWeight: "600", textAlign: "center" }}>{title}</Text>
      {message ? (
        <Text style={{ color: p.textMuted, fontSize: 15, textAlign: "center", maxWidth: 360 }}>
          {message}
        </Text>
      ) : null}
      {children ? <View style={{ marginTop: space.sm, gap: space.sm }}>{children}</View> : null}
    </View>
  );
}
