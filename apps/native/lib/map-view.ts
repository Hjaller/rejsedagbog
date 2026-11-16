import type { LocalPost } from "@/lib/local-db/repo";

export type PositionedPost = LocalPost & { lat: number; lon: number };

export const hasPosition = (post: LocalPost): post is PositionedPost => post.lat != null && post.lon != null;

/** Hvor kortet starter: hele rejsen inden for skærmen, eller ét punkt, hvis alle ligger samme sted. */
export type MapView =
  | { kind: "bounds"; bounds: [west: number, south: number, east: number, north: number] }
  | { kind: "center"; center: [lon: number, lat: number]; zoom: number };

/** Under ca. 1 km i begge retninger giver fitBounds et absurd zoom-niveau. */
const MIN_SPAN_DEG = 0.01;

export function viewForPosts(posts: PositionedPost[]): MapView | null {
  if (posts.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { lat, lon } of posts) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (east - west < MIN_SPAN_DEG && north - south < MIN_SPAN_DEG) {
    return { kind: "center", center: [(west + east) / 2, (south + north) / 2], zoom: 13 };
  }
  return { kind: "bounds", bounds: [west, south, east, north] };
}
