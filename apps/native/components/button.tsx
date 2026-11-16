import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { ActivityIndicator, Pressable, Text, type StyleProp, type ViewStyle } from "react-native";

import { radius, space, usePalette } from "@/lib/theme";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: ComponentProps<typeof Ionicons>["name"];
  disabled?: boolean;
  loading?: boolean;
  size?: "md" | "lg";
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  loading,
  size = "md",
  style,
  accessibilityHint,
}: ButtonProps) {
  const p = usePalette();
  const colors: Record<Variant, { bg: string; fg: string; border: string }> = {
    primary: { bg: p.ink, fg: p.onInk, border: p.ink },
    accent: { bg: p.accent, fg: p.onAccent, border: p.accent },
    secondary: { bg: p.surface, fg: p.text, border: p.borderStrong },
    ghost: { bg: "transparent", fg: p.text, border: "transparent" },
    danger: { bg: "transparent", fg: p.danger, border: p.danger },
  };
  const c = colors[variant];
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        {
          minHeight: size === "lg" ? 52 : 44,
          paddingHorizontal: space.lg,
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.bg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          opacity: inactive ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={c.fg} /> : null}
          <Text style={{ color: c.fg, fontSize: size === "lg" ? 17 : 15, fontWeight: "600" }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}
