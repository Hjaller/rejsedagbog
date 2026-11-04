import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MediaStorage } from "@rejsedagbog/api/storage";
import { SIGNED_URL_TTL_SECONDS } from "@rejsedagbog/shared";

export type S3Config = {
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_FORCE_PATH_STYLE?: boolean;
};

/**
 * Udbyder-neutral S3-lagring (R2, Hetzner, B2, AWS …). Kun basale operationer
 * bruges, så et skift af udbyder kun kræver nye miljøvariabler.
 * Returnerer null, hvis lageret ikke er konfigureret endnu.
 */
export function createS3Storage(env: S3Config): MediaStorage | null {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    return null;
  }
  const bucket = S3_BUCKET;

  const client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: env.S3_REGION || "auto",
    forcePathStyle: env.S3_FORCE_PATH_STYLE ?? false,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    // Nogle S3-kompatible udbydere afviser de nye standard-checksums fra SDK v3.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    signedGetUrl(key) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: SIGNED_URL_TTL_SECONDS,
      });
    },
    async delete(keys) {
      // DeleteObjects tager højst 1000 nøgler pr. kald.
      for (let i = 0; i < keys.length; i += 1000) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
    },
  };
}
