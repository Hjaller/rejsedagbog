import path from "node:path";

import { createAuth } from "@rejsedagbog/auth";
import { createPrismaClient } from "@rejsedagbog/db";

import { ENV } from "./env.server";
import { createS3Storage } from "./storage";
import { createLocalStorage } from "./storage-local";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db);

/**
 * S3, når S3_* er sat. Ellers – kun i udvikling – billeder på disken under
 * apps/server/.data/media, så upload-flowet kan testes før udbyderen er valgt.
 */
export const storage =
  createS3Storage(ENV) ??
  (ENV.NODE_ENV === "development"
    ? createLocalStorage(path.resolve(".data/media"), ENV.BETTER_AUTH_SECRET)
    : null);

export const storageKind = !storage ? "ingen" : "isLocal" in storage ? "lokal disk (kun udvikling)" : "S3";
