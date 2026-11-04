import { buildApp } from "./app";
import { ENV } from "./env.server";
import { auth, db, storage, storageKind } from "./services";

const app = await buildApp({
  db,
  auth,
  storage,
  restCountriesApiKey: ENV.REST_COUNTRIES_API_KEY || null,
  corsOrigin: ENV.CORS_ORIGIN,
  // I drift står serveren bag en reverse proxy med TLS (kravspec afsnit 4).
  trustProxy: ENV.NODE_ENV === "production",
});

app.log.info(`Billedlager: ${storageKind}`);
if (!storage) app.log.warn("S3_* er ikke sat – billeder kan ikke uploades eller vises.");

try {
  await app.listen({ port: 3000, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
