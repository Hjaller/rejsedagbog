import { buildApp } from "./app";
import { ENV } from "./env.server";
import { auth, db, storage, storageKind } from "./services";
import { parseTrustProxy } from "./trust-proxy";

const trustProxy = parseTrustProxy(ENV.TRUST_PROXY);

const app = await buildApp({
  db,
  auth,
  storage,
  restCountriesApiKey: ENV.REST_COUNTRIES_API_KEY || null,
  corsOrigin: ENV.CORS_ORIGIN,
  trustProxy,
});

app.log.info(`Billedlager: ${storageKind}`);
// I drift står serveren bag en reverse proxy med TLS (kravspec afsnit 4).
if (ENV.NODE_ENV === "production" && trustProxy === false) {
  app.log.warn("TRUST_PROXY er ikke sat – bag en proxy deler alle brugere samme rate limit.");
}
if (!storage) app.log.warn("S3_* er ikke sat – billeder kan ikke uploades eller vises.");

try {
  await app.listen({ port: 3000, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
