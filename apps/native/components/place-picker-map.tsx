import Ionicons from "@expo/vector-icons/Ionicons";
import { Camera, Map, type CameraRef } from "@maplibre/maplibre-react-native";
import { useImperativeHandle, useRef, type Ref } from "react";
import { useColorScheme, View } from "react-native";

import { OsmAttribution, osmStyle } from "@/components/trip-map";
import type { MapView } from "@/lib/map-view";
import { usePalette } from "@/lib/theme";

export type LngLat = [lon: number, lat: number];

export type PlacePickerMapHandle = {
  /** Flytter kortet hen til et sted (fx et søgeresultat eller ens position). */
  flyTo: (center: LngLat, zoom?: number) => void;
};

const PIN_SIZE = 44;
const PADDING = { top: 48, right: 48, bottom: 48, left: 48 };

/**
 * Kort til at sætte et sted: nålen står fast midt på kortet, og man flytter kortet
 * under den eller trykker der, hvor stedet er. `onCenterChange` får midten, hver gang
 * kortet har lagt sig til ro.
 */
export function PlacePickerMap({
  initial,
  onCenterChange,
  onUserMove,
  ref,
}: {
  initial: MapView;
  onCenterChange: (center: LngLat) => void;
  /** Brugeren har selv flyttet kortet eller trykket på det (ikke flyTo fra appen). */
  onUserMove: () => void;
  ref?: Ref<PlacePickerMapHandle>;
}) {
  const p = usePalette();
  const dark = useColorScheme() === "dark";
  const camera = useRef<CameraRef>(null);

  useImperativeHandle(ref, () => ({
    flyTo: (center, zoom = 16) => camera.current?.flyTo({ center, zoom, duration: 800 }),
  }));

  return (
    <View style={{ flex: 1 }}>
      <Map
        style={{ flex: 1 }}
        mapStyle={osmStyle(dark, p.surfaceMuted)}
        attribution={false}
        logo={false}
        touchPitch={false}
        touchRotate={false}
        onRegionDidChange={(e) => {
          onCenterChange(e.nativeEvent.center);
          if (e.nativeEvent.userInteraction) onUserMove();
        }}
        onPress={(e) => {
          onUserMove();
          camera.current?.easeTo({ center: e.nativeEvent.lngLat, duration: 300 });
        }}
      >
        <Camera
          ref={camera}
          maxZoom={18}
          initialViewState={
            initial.kind === "bounds"
              ? { bounds: initial.bounds, padding: PADDING }
              : { center: initial.center, zoom: initial.zoom }
          }
        />
      </Map>

      {/* Nålens spids står præcis midt på kortet. */}
      <View
        pointerEvents="none"
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(0,0,0,0.35)" }} />
        <Ionicons
          name="location"
          size={PIN_SIZE}
          color={p.accent}
          style={{ position: "absolute", transform: [{ translateY: -PIN_SIZE / 2 + 2 }] }}
        />
      </View>

      <OsmAttribution />
    </View>
  );
}
