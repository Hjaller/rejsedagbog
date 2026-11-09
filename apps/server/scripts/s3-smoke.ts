/**
 * Røgtest af S3-bucket'en (Hetzner Object Storage) med de S3_*-værdier, der står i .env.
 * Kør: npm run s3:smoke -w server
 *
 * Tjekker, at serveren kan lægge et objekt op, at et signeret link virker,
 * at bucket'en er privat (usigneret link giver 403), og at sletning virker.
 */
import { randomUUID } from "node:crypto";

import { ENV } from "../src/env.server";
import { createS3Storage } from "../src/storage";

const storage = createS3Storage(ENV);
if (!storage) {
  console.error("S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID og S3_SECRET_ACCESS_KEY skal være sat.");
  process.exit(1);
}

const key = `smoke/${randomUUID()}.txt`;
const body = `rejsepost røgtest ${new Date().toISOString()}`;
let failed = false;

function check(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "OK  " : "FEJL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
}

/** Objektets adresse uden signatur – må ikke kunne hentes. */
function unsignedUrl(objectKey: string) {
  const endpoint = new URL(ENV.S3_ENDPOINT!);
  return ENV.S3_FORCE_PATH_STYLE
    ? `${endpoint.origin}/${ENV.S3_BUCKET}/${objectKey}`
    : `${endpoint.protocol}//${ENV.S3_BUCKET}.${endpoint.host}/${objectKey}`;
}

console.log(`Bucket ${ENV.S3_BUCKET} på ${ENV.S3_ENDPOINT} (region ${ENV.S3_REGION || "auto"})\n`);

try {
  await storage.put(key, new TextEncoder().encode(body), "text/plain; charset=utf-8");
  check(true, "PutObject");

  const signed = await storage.signedGetUrl(key);
  const res = await fetch(signed);
  const text = await res.text();
  check(res.status === 200 && text === body, "Signeret GET-link", `HTTP ${res.status}`);

  const direct = await fetch(unsignedUrl(key));
  check(direct.status === 403, "Bucket er privat (usigneret GET giver 403)", `HTTP ${direct.status}`);

  await storage.delete([key]);
  const afterDelete = await fetch(await storage.signedGetUrl(key));
  check(afterDelete.status === 404, "DeleteObjects", `HTTP ${afterDelete.status} efter sletning`);
} catch (error) {
  check(false, "Kald til S3", error instanceof Error ? error.message : String(error));
  // Ryd op, hvis objektet nåede at blive lagt op.
  await storage.delete([key]).catch(() => {});
}

process.exit(failed ? 1 : 0);
