import { useColorScheme } from "react-native";

/**
 * Rejsepost-paletten. Papir-agtige flader og blæk-sort til primære handlinger
 * (som i wireframes) med en poststempel-rød accent til status og aktiv navigation.
 */
const light = {
  background: "#FBFAF7",
  surface: "#FFFFFF",
  surfaceMuted: "#F2F0EA",
  border: "#E3E0D8",
  borderStrong: "#C9C5BA",
  text: "#1C1B19",
  textMuted: "#6B675F",
  ink: "#1C1B19",
  onInk: "#FFFFFF",
  accent: "#B9472A",
  success: "#2F7D4F",
  warning: "#A86B12",
  danger: "#B3261E",
  placeholder: "#E9E6DF",
};

const dark: typeof light = {
  background: "#151412",
  surface: "#1E1D1A",
  surfaceMuted: "#2A2825",
  border: "#34322E",
  borderStrong: "#4A4740",
  text: "#F3F1EC",
  textMuted: "#A29D93",
  ink: "#F3F1EC",
  onInk: "#151412",
  accent: "#E07A5F",
  success: "#6FBF8E",
  warning: "#E0A84F",
  danger: "#F2827A",
  placeholder: "#2A2825",
};

export type Palette = typeof light;

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const NAV_THEME = { light, dark };
