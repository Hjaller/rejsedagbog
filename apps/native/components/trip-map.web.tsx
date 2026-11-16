import { EmptyState } from "@/components/empty-state";
import type { MapView, PositionedPost } from "@/lib/map-view";

/** MapLibre React Native findes kun til iOS/Android. På web vises kortet i Next.js-appen. */
export function TripMap(_: {
  posts: PositionedPost[];
  view: MapView;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return <EmptyState icon="map-outline" title="Kortet findes i appen" message="Åbn Rejsepost på din telefon for at se kortet." />;
}
