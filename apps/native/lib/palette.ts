/**
 * Rejsepost-paletten (redesign D, "postkort"): papirflade, blæk-sort til primære
 * handlinger og poststempel-rød til "+", stempler og det, der venter på upload.
 *
 * Filen importerer ikke React Native, så kontrasten kan testes i Node
 * (apps/server/test/contrast.test.ts).
 */
export const light = {
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
  success: "#256B42",
  warning: "#8A560B",
  danger: "#B3261E",
  placeholder: "#E9E2D3",
};

export const dark: typeof light = {
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
