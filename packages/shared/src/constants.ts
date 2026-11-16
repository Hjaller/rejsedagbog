/** Maks. længde på et indlægs tekst (kravspec: validering af tekstlængde). */
export const POST_TEXT_MAX = 500;

export const TRIP_NAME_MAX = 80;

/** Invitationskoder er 6 tegn: store bogstaver og cifre. */
export const INVITE_CODE_LENGTH = 6;
export const INVITE_CODE_PATTERN = /^[A-Z0-9]{6}$/;

/** Grænser for billedupload, håndhæves på serveren. */
export const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
// HEIC understøttes ikke af sharp-binærerne; appen sender JPEG (komprimeret i image-picker).
export const UPLOAD_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Video (Could): højst 30 sekunder. Serveren genkoder ikke, så en 4K-video fra en
 * Android-telefon kan fylde meget; grænsen er sat efter det.
 */
export const VIDEO_MAX_SECONDS = 30;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
/** Android giver MP4, iOS QuickTime (.mov). Indholdet tjekkes med ffmpeg på serveren. */
export const VIDEO_ALLOWED_MIME_TYPES = ["video/mp4", "video/quicktime", "video/3gpp"] as const;

export const MEDIA_KINDS = ["photo", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Levetid for presigned GET-URL'er til billeder. */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

/** Synkroniseringsstatus for et indlæg i appen (kravspec afsnit 4: lokal → uploader → synkroniseret). */
export const SYNC_STATUSES = ["lokal", "uploader", "synkroniseret", "fejl"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];
