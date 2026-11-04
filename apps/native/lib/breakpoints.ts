import { useWindowDimensions } from "react-native";

/**
 * Tre layouts fra kravspec afsnit 4:
 * - compact  (< 600 dp): bundbar, én kolonne, galleri i 3 kolonner
 * - medium   (600–840 dp): sidebar, galleri i 5 kolonner
 * - expanded (> 840 dp): sidebar + master/detail
 */
export type Breakpoint = "compact" | "medium" | "expanded";

export function breakpointFor(width: number): Breakpoint {
  if (width < 600) return "compact";
  if (width <= 840) return "medium";
  return "expanded";
}

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return breakpointFor(width);
}

export function galleryColumns(bp: Breakpoint, width: number): number {
  if (bp === "compact") return 3;
  if (bp === "medium") return width < 720 ? 5 : 6;
  return 4; // expanded: galleriet deler skærmen med billedet til højre
}
