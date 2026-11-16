import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { Text, View } from "react-native";

import { space, typo, usePalette } from "@/lib/theme";

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
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          borderWidth: 1.5,
          borderStyle: "dashed",
          borderColor: p.borderStrong,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={32} color={p.textMuted} />
      </View>
      <Text accessibilityRole="header" style={[typo.heading, { color: p.text, fontSize: 22, lineHeight: 28, textAlign: "center" }]}>
        {title}
      </Text>
      {message ? (
        <Text style={{ color: p.textMuted, fontSize: 15, textAlign: "center", maxWidth: 360 }}>
          {message}
        </Text>
      ) : null}
      {children ? <View style={{ marginTop: space.sm, gap: space.sm }}>{children}</View> : null}
    </View>
  );
}
