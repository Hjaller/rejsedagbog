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

/** Levetid for presigned GET-URL'er til billeder. */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

/** Synkroniseringsstatus for et indlæg i appen (kravspec afsnit 4: lokal → uploader → synkroniseret). */
export const SYNC_STATUSES = ["lokal", "uploader", "synkroniseret", "fejl"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];
