import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";

export type PickedPhoto = {
  uri: string;
  width: number;
  height: number;
  /** Tidspunkt og position fra billedets EXIF. Androids album fjerner ofte positionen. */
  takenAt: string | null;
  coords: Coords | null;
};

export type Coords = { lat: number; lon: number };

export type PickResult =
  | { status: "ok"; photo: PickedPhoto }
  | { status: "canceled" }
  | { status: "denied" }
  /** Intet kamera (fx simulator eller web) eller en fejl i systemets kamera-app. */
  | { status: "unavailable" };

const pickerOptions: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  // Komprimér i appen, så upload over dyre mobildata bliver mindre (udviklingsplan afsnit 9).
  quality: 0.8,
  exif: true,
};

/**
 * Åbner telefonens eget kamera (ikke et kamera bygget i appen). Kamera-tilladelsen
 * bedes først om her, når brugeren trykker på "+".
 */
export async function takePhoto(): Promise<PickResult> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { status: "denied" };
    const result = await ImagePicker.launchCameraAsync(pickerOptions);
    return toPickResult(result);
  } catch (e) {
    console.warn("[media] kameraet kunne ikke åbnes", e);
    return { status: "unavailable" };
  }
}

/** Så mange billeder kan vælges fra albummet ad gangen. */
export const ALBUM_LIMIT = 20;

export type PickManyResult =
  | { status: "ok"; photos: PickedPhoto[] }
  | { status: "canceled" }
  | { status: "unavailable" };

/**
 * Telefonens album, hvor man kan vælge et eller flere billeder. Systemets vælger
 * kræver ingen tilladelse, fordi appen kun får de billeder, man vælger.
 */
export async function pickPhotos(): Promise<PickManyResult> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      ...pickerOptions,
      allowsMultipleSelection: true,
      selectionLimit: ALBUM_LIMIT,
      orderedSelection: true,
    });
    if (result.canceled || result.assets.length === 0) return { status: "canceled" };
    return { status: "ok", photos: result.assets.map(toPhoto) };
  } catch (e) {
    console.warn("[media] albummet kunne ikke åbnes", e);
    return { status: "unavailable" };
  }
}

/**
 * Android kan lukke appen, mens systemets kamera er åbent; så er billedet ikke
 * kommet tilbage til opret-skærmen. Det hentes her, når appen starter igen.
 * Giver altid null på iOS og web.
 */
export async function recoverPendingPhoto(): Promise<PickedPhoto | null> {
  if (process.env.EXPO_OS !== "android") return null;
  try {
    const result = await ImagePicker.getPendingResultAsync();
    if (!result || !("canceled" in result)) return null;
    const picked = toPickResult(result);
    return picked.status === "ok" ? picked.photo : null;
  } catch {
    return null;
  }
}

// Billedet fra recoverPendingPhoto, indtil opret-skærmen henter det.
let recoveredPhoto: PickedPhoto | null = null;

export function stashRecoveredPhoto(photo: PickedPhoto) {
  recoveredPhoto = photo;
}

/** Henter (og fjerner) det reddede billede. */
export function takeRecoveredPhoto(): PickedPhoto | null {
  const photo = recoveredPhoto;
  recoveredPhoto = null;
  return photo;
}

function toPickResult(result: ImagePicker.ImagePickerResult): PickResult {
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { status: "canceled" };
  return { status: "ok", photo: toPhoto(asset) };
}

function toPhoto(asset: ImagePicker.ImagePickerAsset): PickedPhoto {
  return {
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    takenAt: exifDate(asset.exif),
    coords: exifCoords(asset.exif),
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

/** Estimat, når opret-skærmen åbnes: hurtigt, men kan være op til 2 min gammelt. */
export const SCREEN_OPEN_MAX_AGE_MS = 2 * 60_000;
/** Når et billede tages: positionen skal være der, hvor billedet blev taget (fx i et tog). */
export const CAPTURE_MAX_AGE_MS = 10_000;

export type LocationPermission = "granted" | "undetermined" | "denied";

/**
 * Status for "mens appen bruges"-tilladelsen, uden at spørge. "denied" betyder, at
 * systemet ikke vil spørge igen, så kun telefonens indstillinger kan ændre det.
 */
export async function getLocationPermission(): Promise<LocationPermission> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.granted) return "granted";
    return perm.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "denied";
  }
}

/** Viser systemets dialog. Kaldes først, når brugeren har set forklaringen og trykket "Tillad". */
export async function requestLocationPermission(): Promise<LocationPermission> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.granted) return "granted";
    return perm.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "denied";
  }
}

/**
 * Kun "mens appen bruges"-tilladelse. `maxAgeMs` er, hvor gammel en tidligere position
 * må være, før der måles en ny. Med `request: false` spørges der ikke om tilladelse
 * (det gør forklaringsskærmen), og uden tilladelse er svaret "denied".
 */
export async function getCurrentCoords({
  maxAgeMs = SCREEN_OPEN_MAX_AGE_MS,
  request = true,
}: { maxAgeMs?: number; request?: boolean } = {}): Promise<LocationResult> {
  try {
    const perm = request
      ? await Location.requestForegroundPermissionsAsync()
      : await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return { status: "denied" };
    const last = await Location.getLastKnownPositionAsync({ maxAge: maxAgeMs, requiredAccuracy: 200 });
    // Uden dialogen om Googles "Location Accuracy": den ville dukke op, hver gang skærmen åbnes,
    // og et nej ville give indlægget uden position, selvom GPS'en virker.
    // High, fordi Balanced ikke tænder GPS'en, når Location Accuracy er slået fra.
    const pos =
      last ??
      (await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: false,
      }));
    return { status: "ok", coords: { lat: pos.coords.latitude, lon: pos.coords.longitude } };
  } catch {
    return { status: "unavailable" };
  }
}
