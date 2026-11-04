import { View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { TripHeader } from "@/components/trip-header";
import { useActiveTrip, usePendingCount, usePosts } from "@/lib/local-db/queries";

/** Kortvisning er en Should-funktion (udviklingsplan uge 3). Indtil da vises status. */
export default function MapScreen() {
  const { trip } = useActiveTrip();
  const posts = usePosts(trip?.id);
  const pending = usePendingCount(trip?.id);
  const withPosition = (posts.data ?? []).filter((x) => x.lat != null).length;

  return (
    <View style={{ flex: 1 }}>
      <TripHeader eyebrow="KORT" trip={trip} pendingCount={pending.data ?? 0} />
      <EmptyState
        icon="map-outline"
        title="Kortet kommer snart"
        message={
          withPosition > 0
            ? `${withPosition} af rejsens indlæg har en position og vil blive vist på kortet.`
            : "Indlæg med GPS-position vil blive vist her."
        }
      />
    </View>
  );
}
