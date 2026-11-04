import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";

export type PickedPhoto = {
  uri: string;
  width: number;
  height: number;
  /** Tidspunkt og position fra billedets EXIF (kun for billeder fra galleriet). */
  takenAt: string | null;
  coords: Coords | null;
};

export type Coords = { lat: number; lon: number };

export type PickResult =
  | { status: "ok"; photo: PickedPhoto }
  | { status: "canceled" }
  | { status: "denied" };

const pickerOptions: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  // Komprimér i appen, så upload over dyre mobildata bliver mindre (udviklingsplan afsnit 9).
  quality: 0.8,
  exif: true,
};

/** Kamera-tilladelsen bedes først om her, når brugeren trykker "Tag billede". */
export async function takePhoto(): Promise<PickResult> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { status: "denied" };
  const result = await ImagePicker.launchCameraAsync(pickerOptions);
  return toPickResult(result);
}

export async function pickPhoto(): Promise<PickResult> {
  const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
  return toPickResult(result);
}

function toPickResult(result: ImagePicker.ImagePickerResult): PickResult {
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { status: "canceled" };
  return {
    status: "ok",
    photo: {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      takenAt: exifDate(asset.exif),
      coords: exifCoords(asset.exif),
    },
  };
}

// iOS lægger GPS-data i en "{GPS}"-ordbog; Android har dem i roden.
function exifCoords(exif: Record<string, unknown> | null | undefined): Coords | null {
  if (!exif) return null;
  const gps = (exif["{GPS}"] as Record<string, unknown> | undefined) ?? exif;
  const lat = Number(gps.GPSLatitude ?? gps.Latitude);
  const lon = Number(gps.GPSLongitude ?? gps.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
  const latRef = String(gps.GPSLatitudeRef ?? gps.LatitudeRef ?? "N");
  const lonRef = String(gps.GPSLongitudeRef ?? gps.LongitudeRef ?? "E");
  return {
    lat: latRef === "S" ? -Math.abs(lat) : lat,
    lon: lonRef === "W" ? -Math.abs(lon) : lon,
  };
}

function exifDate(exif: Record<string, unknown> | null | undefined): string | null {
  const exifDict = (exif?.["{Exif}"] as Record<string, unknown> | undefined) ?? exif;
  const raw = exifDict?.DateTimeOriginal ?? exifDict?.DateTime;
  if (typeof raw !== "string") return null;
  // "2026:05:14 14:32:10" (lokal tid på kameraet)
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  const date = new Date(y!, mo! - 1, d!, h!, mi!, s!);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Kopierer billedet ind i appens dokumentmappe, så det overlever, at kamerarullen
 * eller cachen ryddes, og kan uploades senere.
 */
export function persistPhoto(sourceUri: string, postId: string): string {
  const dir = new Directory(Paths.document, "images");
  dir.create({ intermediates: true, idempotent: true });
  const source = new File(sourceUri);
  const ext = source.extension || ".jpg";
  const dest = new File(dir, `${postId}${ext}`);
  if (dest.exists) dest.delete();
  source.copy(dest);
  return dest.uri;
}

export type LocationResult = { status: "ok"; coords: Coords } | { status: "denied" } | { status: "unavailable" };

/** Kun "mens appen bruges"-tilladelse, og først når opret-skærmen åbnes. */
export async function getCurrentCoords(): Promise<LocationResult> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return { status: "denied" };
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000, requiredAccuracy: 200 });
    const pos =
      last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { status: "ok", coords: { lat: pos.coords.latitude, lon: pos.coords.longitude } };
  } catch {
    return { status: "unavailable" };
  }
}
