import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MediaStorage } from "@rejsedagbog/api/storage";
import { SIGNED_URL_TTL_SECONDS } from "@rejsedagbog/shared";

/**
 * KUN TIL UDVIKLING: gemmer billeder på disken, indtil S3-udbyderen er valgt.
 * Links er signeret med HMAC og udløber som presigned S3-URL'er, så appen
 * opfører sig ens. URL'erne er relative (/api/media/...), og klienten sætter
 * sin egen server-adresse foran (localhost, LAN-IP eller emulatorens 10.0.2.2).
 */
export type LocalMediaStorage = MediaStorage & {
  isLocal: true;
  /** Returnerer filstien, hvis signaturen er gyldig og ikke udløbet. */
  resolveSigned(key: string, exp: string, sig: string): string | null;
};

const KEY_PATTERN = /^trips\/[0-9a-f-]{36}\/[0-9a-f-]{36}(_thumb\.jpg|\.jpg|\.mp4)$/;

export function createLocalStorage(rootDir: string, secret: string): LocalMediaStorage {
  const sign = (key: string, exp: number) =>
    createHmac("sha256", secret).update(`${key}\n${exp}`).digest("base64url");

  const fileFor = (key: string) => {
    if (!KEY_PATTERN.test(key)) throw new Error(`Ugyldig objektnøgle: ${key}`);
    return path.join(rootDir, ...key.split("/"));
  };

  return {
    isLocal: true,
    async put(key, body) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    },
    async signedGetUrl(key) {
      const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
      const params = new URLSearchParams({ exp: String(exp), sig: sign(key, exp) });
      return `/api/media/${key}?${params}`;
    },
    async delete(keys) {
      await Promise.all(keys.map((k) => rm(fileFor(k), { force: true })));
    },
    resolveSigned(key, exp, sig) {
      if (!KEY_PATTERN.test(key)) return null;
      const expNum = Number(exp);
      if (!Number.isInteger(expNum) || expNum < Date.now() / 1000) return null;
      const expected = Buffer.from(sign(key, expNum));
      const given = Buffer.from(sig);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      return fileFor(key);
    },
  };
}
