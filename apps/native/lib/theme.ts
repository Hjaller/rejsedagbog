import type { TextStyle } from "react-native";
import { PixelRatio, useColorScheme } from "react-native";

import { dark, light, type Palette } from "./palette";

export type { Palette };

/** Mindste trykfelt: 48 dp (Android) dækker også iOS' 44 pt. */
export const MIN_TOUCH = 48;

/**
 * Linjeloft, der følger skriftstørrelsen: med stor skrift (tilgængelighed, op til 200 %)
 * får teksten dobbelt så mange linjer, så navne og steder ikke bliver skåret af.
 */
export function scaledLines(lines: number): number {
  return PixelRatio.getFontScale() > 1.3 ? lines * 2 : lines;
}

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
