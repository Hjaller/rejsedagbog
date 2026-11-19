import { describe, expect, it } from "vitest";

import { dark, light, type Palette } from "../../native/lib/palette";

/** WCAG 2.x: relativ luminans og kontrastforhold. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Farver, der bruges til tekst og ikoner, og de flader, de står på. */
const FOREGROUNDS = ["text", "textMuted", "accentText", "success", "warning", "danger"] as const;
const SURFACES = ["background", "surface", "paper", "surfaceMuted"] as const;
/** Tekst på udfyldte knapper. */
const FILLED = [
  ["onInk", "ink"],
  ["onAccent", "accent"],
] as const;

describe.each([
  ["lyst tema", light],
  ["mørkt tema", dark],
] as [string, Palette][])("tekstkontrast i %s (WCAG AA, mindst 4,5:1)", (_name, palette) => {
  for (const fg of FOREGROUNDS) {
    for (const bg of SURFACES) {
      it(`${fg} på ${bg}`, () => {
        expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  for (const [fg, bg] of FILLED) {
    it(`${fg} på ${bg}`, () => {
      expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("kontrastberegningen", () => {
  it("giver 21:1 for sort på hvid", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });
});
