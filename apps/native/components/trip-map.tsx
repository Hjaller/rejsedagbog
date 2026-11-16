import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Camera,
  Map,
  Marker,
  TransformRequestManager,
  type CameraRef,
  type StyleSpecification,
} from "@maplibre/maplibre-react-native";
import { Image } from "expo-image";
import { useRef } from "react";
import { Linking, Pressable, Text, useColorScheme, View } from "react-native";

import { type MapView, type PositionedPost } from "@/lib/map-view";
import { postImageSource } from "@/lib/local-db/repo";
import { radius, space, usePalette } from "@/lib/theme";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";

// OSM's brugspolitik for tiles kræver en User-Agent, der identificerer appen.
try {
  TransformRequestManager.addHeader({
    id: "osm-user-agent",
    match: "tile\\.openstreetmap\\.org",
    name: "User-Agent",
    value: "Rejsepost/1.0 (+https://rejsepost.leth.dev)",
  });
} catch {
  // Uden native modul (fx i tests) bruges MapLibres standard-User-Agent.
}

export function osmStyle(dark: boolean, background: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [OSM_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap-bidragydere",
      },
    },
    // OSM har kun lyse tiles; i mørk tilstand dæmpes de, så kortet ikke blænder.
    // Baggrunden ses offline, hvor kun tidligere viste tiles er gemt (ellers er kortet sort).
    layers: [
      { id: "baggrund", type: "background", paint: { "background-color": background } },
      {
        id: "osm",
        type: "raster",
        source: "osm",
        paint: dark ? { "raster-brightness-max": 0.7, "raster-saturation": -0.3 } : {},
      },
    ],
  };
}

const FIT_PADDING = { top: 72, right: 56, bottom: 160, left: 56 };

/**
 * Kort over rejsens indlæg med position (Should 5): MapLibre med OpenStreetMap-tiles,
 * ingen API-nøgle. Hvert indlæg er en rund miniature; et tryk vælger det.
 */
export function TripMap({
  posts,
  view,
  selectedId,
  onSelect,
}: {
  posts: PositionedPost[];
  view: MapView;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const p = usePalette();
  const camera = useRef<CameraRef>(null);
  const dark = useColorScheme() === "dark";

  const fitAll = (duration = 600) => {
    if (view.kind === "bounds") camera.current?.fitBounds(view.bounds, { padding: FIT_PADDING, duration });
    else camera.current?.flyTo({ center: view.center, zoom: view.zoom, duration });
  };

  return (
    <View style={{ flex: 1 }}>
      <Map
        style={{ flex: 1 }}
        mapStyle={osmStyle(dark, p.surfaceMuted)}
        attribution={false}
        logo={false}
        compass
        compassPosition={{ top: space.lg, left: space.lg }}
        touchPitch={false}
        // initialViewState rammer ikke altid rigtigt, før kortets størrelse kendes; tilpas igen.
        onDidFinishLoadingMap={() => fitAll(0)}
      >
        <Camera
          ref={camera}
          maxZoom={18}
          initialViewState={
            view.kind === "bounds"
              ? { bounds: view.bounds, padding: FIT_PADDING }
              : { center: view.center, zoom: view.zoom }
          }
        />
        {posts.map((post) => (
          <Marker
            key={post.id}
            id={post.id}
            lngLat={[post.lon, post.lat]}
            anchor="center"
            selected={post.id === selectedId}
            onPress={() => onSelect(post.id)}
          >
            <PostPin post={post} selected={post.id === selectedId} />
          </Marker>
        ))}
      </Map>

      <Pressable
        onPress={() => fitAll()}
        accessibilityRole="button"
        accessibilityLabel="Vis alle indlæg på kortet"
        hitSlop={8}
        style={({ pressed }) => ({
          position: "absolute",
          top: space.lg,
          right: space.lg,
          width: 44,
          height: 44,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? p.surfaceMuted : p.surface,
          borderWidth: 1,
          borderColor: p.border,
          boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        })}
      >
        <Ionicons name="scan-outline" size={22} color={p.text} />
      </Pressable>

      <OsmAttribution />
    </View>
  );
}

/** OSM kræver synlig kreditering på kortet. */
export function OsmAttribution() {
  return (
    <Pressable
      onPress={() => Linking.openURL(OSM_COPYRIGHT)}
      accessibilityRole="link"
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        paddingHorizontal: 6,
        paddingVertical: 2,
        backgroundColor: "rgba(255,255,255,0.75)",
        borderTopLeftRadius: 4,
      }}
    >
      <Text style={{ fontSize: 11, color: "#333" }}>© OpenStreetMap-bidragydere</Text>
    </Pressable>
  );
}

const PIN = 44;

function PostPin({ post, selected }: { post: PositionedPost; selected: boolean }) {
  const p = usePalette();
  const source = postImageSource(post, "thumb");
  const pending = post.syncStatus !== "synkroniseret";
  const size = selected ? PIN + 12 : PIN;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 3,
        borderColor: selected ? p.accent : "#FFFFFF",
        borderStyle: pending && !selected ? "dashed" : "solid",
        backgroundColor: p.surface,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
      }}
    >
      {source ? (
        <Image source={source} style={{ width: "100%", height: "100%" }} contentFit="cover" recyclingKey={post.id} />
      ) : (
        <Ionicons name="chatbubble-ellipses" size={20} color={p.accent} />
      )}
    </View>
  );
}
