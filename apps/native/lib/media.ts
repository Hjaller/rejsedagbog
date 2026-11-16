import { VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS, type MediaKind } from "@rejsedagbog/shared";
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as VideoThumbnails from "expo-video-thumbnails";

/** Et billede eller en video fra kameraet eller albummet. */
export type PickedMedia = {
  kind: MediaKind;
  uri: string;
  width: number;
  height: number;
  /** Tidspunkt og position fra billedets EXIF. Androids album fjerner ofte positionen; videoer har ingen. */
  takenAt: string | null;
  coords: Coords | null;
  /** Kun for video. */
  durationMs: number | null;
  fileSize: number | null;
};

export type Coords = { lat: number; lon: number };

/** Hvorfor en video ikke kan bruges. Serveren afviser den alligevel, så den stoppes her. */
export type VideoProblem = "tooLong" | "tooLarge";

export type PickResult =
  | { status: "ok"; media: PickedMedia }
  | { status: "canceled" }
  | { status: "denied" }
  | { status: "rejected"; problem: VideoProblem }
  /** Intet kamera (fx simulator eller web) eller en fejl i systemets kamera-app. */
  | { status: "unavailable" };

const photoOptions: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  // Komprimér i appen, så upload over dyre mobildata bliver mindre (udviklingsplan afsnit 9).
  quality: 0.8,
  exif: true,
};

// Kameraets egen kvalitet. (iOS' "IFrame"-presets er redigeringsformater med meget høj bitrate.)
const videoOptions: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["videos"],
  videoMaxDuration: VIDEO_MAX_SECONDS,
};

/**
 * Åbner telefonens eget kamera (ikke et kamera bygget i appen) til et billede eller en
 * video på højst 30 sekunder. Kamera-tilladelsen bedes først om her.
 */
export async function capture(kind: MediaKind): Promise<PickResult> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { status: "denied" };
    const result = await ImagePicker.launchCameraAsync(kind === "video" ? videoOptions : photoOptions);
    return toPickResult(result);
  } catch (e) {
    console.warn("[media] kameraet kunne ikke åbnes", e);
    return { status: "unavailable" };
  }
}

/** Så mange billeder og videoer kan vælges fra albummet ad gangen. */
export const ALBUM_LIMIT = 20;

export type PickManyResult =
  | {
      status: "ok";
      media: PickedMedia[];
      /** Videoer, der er for lange eller store og derfor er sprunget over. */
      rejected: { problem: VideoProblem }[];
    }
  | { status: "canceled" }
  | { status: "unavailable" };

/**
 * Telefonens album, hvor man kan vælge et eller flere billeder og videoer. Systemets
 * vælger kræver ingen tilladelse, fordi appen kun får det, man vælger. På web kun billeder.
 */
export async function pickFromAlbum(): Promise<PickManyResult> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      ...photoOptions,
      mediaTypes: process.env.EXPO_OS === "web" ? ["images"] : ["images", "videos"],
      videoMaxDuration: VIDEO_MAX_SECONDS,
      allowsMultipleSelection: true,
      selectionLimit: ALBUM_LIMIT,
      orderedSelection: true,
    });
    if (result.canceled || result.assets.length === 0) return { status: "canceled" };
    const media: PickedMedia[] = [];
    const rejected: { problem: VideoProblem }[] = [];
    for (const asset of result.assets) {
      const item = toMedia(asset);
      const problem = videoProblem(item);
      if (problem) rejected.push({ problem });
      else media.push(item);
    }
    return { status: "ok", media, rejected };
  } catch (e) {
    console.warn("[media] albummet kunne ikke åbnes", e);
    return { status: "unavailable" };
  }
}

/** Telefonen runder lidt op, så der gives et halvt sekunds luft (serveren giver et helt). */
function videoProblem(item: PickedMedia): VideoProblem | null {
  if (item.kind !== "video") return null;
  if (item.durationMs != null && item.durationMs > VIDEO_MAX_SECONDS * 1000 + 500) return "tooLong";
  if (item.fileSize != null && item.fileSize > VIDEO_MAX_BYTES) return "tooLarge";
  return null;
}

export function videoProblemText(problem: VideoProblem): string {
  return problem === "tooLong"
    ? `Videoer må højst vare ${VIDEO_MAX_SECONDS} sekunder.`
    : `Videoen fylder for meget (højst ${Math.round(VIDEO_MAX_BYTES / 1024 / 1024)} MB).`;
}

/**
 * Android kan lukke appen, mens systemets kamera er åbent; så er billedet eller videoen
 * ikke kommet tilbage til opret-skærmen. Det hentes her, når appen starter igen.
 * Giver altid null på iOS og web.
 */
export async function recoverPendingMedia(): Promise<PickedMedia | null> {
  if (process.env.EXPO_OS !== "android") return null;
  try {
    const result = await ImagePicker.getPendingResultAsync();
    if (!result || !("canceled" in result)) return null;
    const picked = toPickResult(result);
    return picked.status === "ok" ? picked.media : null;
  } catch {
    return null;
  }
}

// Mediet fra recoverPendingMedia, indtil opret-skærmen henter det.
let recoveredMedia: PickedMedia | null = null;

export function stashRecoveredMedia(media: PickedMedia) {
  recoveredMedia = media;
}

/** Henter (og fjerner) det reddede billede eller den reddede video. */
export function takeRecoveredMedia(): PickedMedia | null {
  const media = recoveredMedia;
  recoveredMedia = null;
  return media;
}

function toPickResult(result: ImagePicker.ImagePickerResult): PickResult {
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { status: "canceled" };
  const media = toMedia(asset);
  const problem = videoProblem(media);
  return problem ? { status: "rejected", problem } : { status: "ok", media };
}

function toMedia(asset: ImagePicker.ImagePickerAsset): PickedMedia {
  const kind: MediaKind = asset.type === "video" ? "video" : "photo";
  return {
    kind,
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    takenAt: kind === "photo" ? exifDate(asset.exif) : null,
    coords: kind === "photo" ? exifCoords(asset.exif) : null,
    durationMs: kind === "video" ? (asset.duration ?? null) : null,
    fileSize: asset.fileSize ?? null,
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

function mediaDir(): Directory {
  const dir = new Directory(Paths.document, "images");
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Kopierer billedet eller videoen ind i appens dokumentmappe, så det overlever, at
 * kamerarullen eller cachen ryddes, og kan uploades senere.
 */
export function persistMedia(sourceUri: string, postId: string, kind: MediaKind = "photo"): string {
  const source = new File(sourceUri);
  const ext = source.extension || (kind === "video" ? ".mp4" : ".jpg");
  const dest = new File(mediaDir(), `${postId}${ext}`);
  if (dest.exists) dest.delete();
  source.copy(dest);
  return dest.uri;
}

/**
 * Plakatramme til en video, gemt ved siden af den, så tidslinjen, galleriet og kortet
 * kan vise videoen offline. Serveren laver sin egen ved upload. null, hvis det fejler
 * (fx på web); så vises en neutral flade, indtil serverens plakat er hentet.
 */
export async function createVideoPoster(videoUri: string, postId: string): Promise<string | null> {
  if (process.env.EXPO_OS === "web") return null;
  // Lige efter kameraet kan Androids MediaMetadataRetriever fejle på en fil, der læses fint
  // et øjeblik senere (set på emulatoren), så der prøves et par gange.
  for (const delayMs of POSTER_RETRY_DELAYS_MS) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 0, quality: 0.8 });
      const dest = new File(mediaDir(), `${postId}_poster.jpg`);
      if (dest.exists) dest.delete();
      new File(uri).move(dest);
      return dest.uri;
    } catch (e) {
      if (delayMs === POSTER_RETRY_DELAYS_MS.at(-1)) {
        console.warn("[media] kunne ikke lave plakatramme til videoen", e);
      }
    }
  }
  return null;
}

const POSTER_RETRY_DELAYS_MS = [0, 300, 1000];

/** "0:12" – videoens længde til mærket på plakaten. */
export function formatDuration(ms: number | null): string {
  if (ms == null) return "";
  const total = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
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
