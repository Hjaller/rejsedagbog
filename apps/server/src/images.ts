import sharp, { type Metadata } from "sharp";

export type ProcessedImage = {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
};

const FULL_MAX_PX = 2048;
const THUMB_PX = 480;

/** Formater sharp kan læse i denne build. HEIC understøttes ikke af de færdige binærer. */
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class UnsupportedImageError extends Error {}

/**
 * Validerer, at filen faktisk er et billede (ikke kun at klienten siger det),
 * retter orienteringen og gemmer som JPEG. sharp fjerner al metadata, herunder
 * EXIF med GPS-position, medmindre man beder om at beholde den.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new UnsupportedImageError("Filen er ikke et gyldigt billede");
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw new UnsupportedImageError("Billedformatet understøttes ikke");
  }

  const { data: full, info } = await sharp(input)
    .rotate() // anvend EXIF-orientering, før metadata fjernes
    .resize({ width: FULL_MAX_PX, height: FULL_MAX_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const thumb = await sharp(full)
    .resize({ width: THUMB_PX, height: THUMB_PX, fit: "cover" })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();

  return { full, thumb, width: info.width, height: info.height };
}
