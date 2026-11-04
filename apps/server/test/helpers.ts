import { randomUUID } from "node:crypto";

import type { MediaStorage } from "@rejsedagbog/api/storage";
import { createAuth } from "@rejsedagbog/auth";
import { createPrismaClient, type Database } from "@rejsedagbog/db";
import sharp from "sharp";

import { buildApp, type App } from "../src/app";
import { TEST_DATABASE_URL } from "./env";

const ORIGIN = "http://localhost:3001";

export type MemoryStorage = MediaStorage & { objects: Map<string, Uint8Array> };

/** Billedlager i hukommelsen (udviklingsplan afsnit 9: S3 mockes i tests). */
export function createMemoryStorage(): MemoryStorage {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key, body) {
      objects.set(key, body);
    },
    async signedGetUrl(key) {
      return `memory://${key}?exp=${Date.now() + 900_000}`;
    },
    async delete(keys) {
      for (const k of keys) objects.delete(k);
    },
  };
}

export type TestContext = {
  app: App;
  db: Database;
  storage: MemoryStorage;
  close: () => Promise<void>;
};

export async function createTestApp(): Promise<TestContext> {
  const db = createPrismaClient({ DATABASE_URL: TEST_DATABASE_URL });
  const auth = createAuth(
    {
      BETTER_AUTH_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "test-secret-som-er-mindst-32-tegn-lang",
      CORS_ORIGIN: ORIGIN,
    },
    db,
  );
  const storage = createMemoryStorage();
  const app = await buildApp({
    db,
    auth,
    storage,
    restCountriesApiKey: null,
    corsOrigin: ORIGIN,
    logger: false,
  });
  await app.ready();
  return {
    app,
    db,
    storage,
    close: async () => {
      await app.close();
      await db.$disconnect();
    },
  };
}

export type TestUser = { id: string; name: string; cookie: string };

export async function signUp(app: App, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    payload: { name, email: `${name.toLowerCase()}-${randomUUID()}@test.dk`, password: "hemmelig123" },
  });
  if (res.statusCode !== 200) throw new Error(`Sign-up fejlede: ${res.statusCode} ${res.body}`);
  const setCookie = res.headers["set-cookie"];
  const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ""]).map((c) => c.split(";")[0]);
  return { id: res.json().user.id, name, cookie: cookies.join("; ") };
}

type TrpcResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string; status: number };

async function trpc<T>(
  app: App,
  kind: "query" | "mutation",
  path: string,
  input: unknown,
  user?: TestUser,
): Promise<TrpcResult<T>> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (user) headers.cookie = user.cookie;
  const res =
    kind === "query"
      ? await app.inject({
          method: "GET",
          url: `/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input ?? null))}`,
          headers,
        })
      : await app.inject({
          method: "POST",
          url: `/trpc/${path}`,
          headers: { ...headers, "content-type": "application/json" },
          payload: JSON.stringify(input ?? null),
        });
  const body = res.json();
  if (body.error) {
    return { ok: false, code: body.error.data.code, message: body.error.message, status: res.statusCode };
  }
  return { ok: true, data: body.result.data as T };
}

export const query = <T = unknown>(app: App, path: string, input: unknown, user?: TestUser) =>
  trpc<T>(app, "query", path, input, user);
export const mutate = <T = unknown>(app: App, path: string, input: unknown, user?: TestUser) =>
  trpc<T>(app, "mutation", path, input, user);

export function newTripInput(name = "Rom 2026") {
  return { id: randomUUID(), name, countryCode: "IT", startDate: "2026-05-12", endDate: "2026-05-19" };
}

/** JPEG med EXIF inkl. GPS, så vi kan tjekke at serveren fjerner den. */
export async function jpegWithGps(width = 1200, height = 800): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } } })
    .withExif({
      IFD0: { Make: "Testkamera", Copyright: "Sara" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 53/1 2484/100", GPSLongitudeRef: "E", GPSLongitude: "12/1 29/1 2/1" },
    })
    .jpeg()
    .toBuffer();
}

/** Bygger et multipart-body til /api/uploads. */
export function uploadPayload(fields: Record<string, string>, file?: { data: Buffer; type: string; name?: string }) {
  const boundary = `----rejsepost${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name ?? "billede.jpg"}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function upload(
  app: App,
  user: TestUser | undefined,
  fields: Record<string, string>,
  file?: { data: Buffer; type: string },
) {
  const { payload, contentType } = uploadPayload(fields, file);
  const headers: Record<string, string> = { "content-type": contentType, origin: ORIGIN };
  if (user) headers.cookie = user.cookie;
  return app.inject({ method: "POST", url: "/api/uploads", headers, payload });
}
