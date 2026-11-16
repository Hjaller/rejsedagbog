import type { Ref } from "react";
import { Text, View } from "react-native";

import type { MapView } from "@/lib/map-view";
import { space, usePalette } from "@/lib/theme";

export type LngLat = [lon: number, lat: number];

export type PlacePickerMapHandle = {
  flyTo: (center: LngLat, zoom?: number) => void;
};

/** MapLibre React Native findes kun til iOS/Android. På web vælges stedet med søgningen. */
export function PlacePickerMap(_: {
  initial: MapView;
  onCenterChange: (center: LngLat) => void;
  onUserMove: () => void;
  ref?: Ref<PlacePickerMapHandle>;
}) {
  const p = usePalette();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>
      <Text style={{ color: p.textMuted, fontSize: 15, textAlign: "center" }}>
        Kortet findes kun i appen. Søg efter stedet ovenfor.
      </Text>
    </View>
  );
}
