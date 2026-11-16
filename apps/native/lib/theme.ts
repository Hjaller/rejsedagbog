import type { TextStyle } from "react-native";
import { useColorScheme } from "react-native";

/**
 * Rejsepost-paletten (redesign D, "postkort"): papirflade, blæk-sort til primære
 * handlinger og poststempel-rød til "+", stempler og det, der venter på upload.
 */
const light = {
  background: "#F6F1E7",
  /** Kort og ark. */
  surface: "#FFFFFF",
  /** Bundbar og sidebar: en anelse varmere end kortene. */
  paper: "#FFFDF8",
  surfaceMuted: "#EFE9DC",
  border: "#E4DDCE",
  borderStrong: "#C9C1B0",
  text: "#1C1B19",
  textMuted: "#6B675F",
  ink: "#1C1B19",
  onInk: "#FFFFFF",
  /** Poststempel-rød som flade (fx "+"-knappen). */
  accent: "#B9472A",
  onAccent: "#FFFFFF",
  /** Rød til tekst og tynde streger på papiret (kontrast ≥ 4,5:1). */
  accentText: "#8A3A22",
  success: "#2F7D4F",
  warning: "#A86B12",
  danger: "#B3261E",
  placeholder: "#E9E2D3",
};

const dark: typeof light = {
  background: "#161412",
  surface: "#201E1B",
  paper: "#1B1917",
  surfaceMuted: "#2C2925",
  border: "#38342E",
  borderStrong: "#4E4941",
  text: "#F3EEE4",
  textMuted: "#A8A196",
  ink: "#F3EEE4",
  onInk: "#161412",
  accent: "#E07A5F",
  onAccent: "#161412",
  accentText: "#EE9A82",
  success: "#6FBF8E",
  warning: "#E0A84F",
  danger: "#F2827A",
  placeholder: "#2C2925",
};

export type Palette = typeof light;

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const radius = { sm: 6, md: 10, lg: 14, xl: 24, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/**
 * Fonte, der hentes i app/_layout.tsx. Overskrifter og indlæggenes tekst er
 * Source Serif 4 (opret, ingen kursiv), små versal-etiketter og koder er Barlow
 * Semi Condensed som tryk på et frimærke; brødtekst bruger telefonens egen skrift.
 * Med egne fonte vælges vægten med navnet, ikke med fontWeight (Android).
 */
export const fonts = {
  display: "SourceSerif4_600SemiBold",
  serif: "SourceSerif4_400Regular",
  label: "BarlowSemiCondensed_600SemiBold",
} as const;

/** Typografi til overskrifter og etiketter. Brug sammen med en farve fra paletten. */
export const typo = {
  /** "REJSEPOST", "STED" – små versaler over en overskrift eller et felt. */
  eyebrow: { fontFamily: fonts.label, fontSize: 12, letterSpacing: 1.4 },
  /** Skærmens titel, fx rejsens navn. */
  hero: { fontFamily: fonts.display, fontSize: 32, letterSpacing: -0.3, lineHeight: 38 },
  /** Titel i et indlæg eller et ark. */
  title: { fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.2, lineHeight: 30 },
  /** Dag-overskrift, kort-titel. */
  heading: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26 },
  /** Indlæggets tekst, skrevet som på et postkort. */
  note: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 24 },
} as const satisfies Record<string, TextStyle>;

export const NAV_THEME = { light, dark };
