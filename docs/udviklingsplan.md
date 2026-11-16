# Udviklingsplan – Rejsepost (Rejsedagbog)

Bygger på *Kravspecifikation – Rejsedagbog* (4. nov. 2026) og det Better-T-Stack-scaffold, der allerede ligger i repoet.
Planen følger kravspecifikationens tre uger og MoSCoW-prioritering. Must-krav udgør MVP'en, og Should/Could laves først, når MVP'en virker.

---

## 0. Ændringer i forhold til kravspecifikationen

| # | Kravspec siger | Ændres til | Begrundelse / konsekvens |
|---|---|---|---|
| 1 | Billeder i S3-kompatibel lagring **(MinIO)**, kørt i Docker Compose | **Hetzner Object Storage** (ekstern, administreret S3-kompatibel lagring, se 0.1) | Ingen storage-container i Compose. Backend taler S3-API via AWS SDK v3 med konfigurerbart endpoint, så udbyderen kan skiftes alene via miljøvariabler. Der bruges separate buckets til dev og prod. |
| 2 | Eget REST-API i Fastify med JSON-schema-validering | **tRPC på Fastify** med Zod-validering (sådan er scaffoldet sat op) + én almindelig REST-route til billedupload (multipart) | Typerne deles automatisk mellem app, web og backend, og Zod giver samme inputvalidering. tRPC håndterer ikke filupload godt, derfor er upload en separat Fastify-route. **Besluttet:** tRPC beholdes til alt andet end filer, billedupload går gennem en Fastify-route, og teksten i kravspec opdateres. |
| 3 | Backend, database og lagring kører i Docker Compose | Compose indeholder `server`, `web` og **`db` (PostgreSQL)**. Scaffoldet mangler db-servicen, så den tilføjes. | Lagring ligger nu uden for Compose (punkt 1). |
| 4 | – | Scaffoldets drawer- og tabs-navigation i `apps/native` erstattes af responsiv navigation (bundbar/sidebar) | Navigationen skal følge de tre layouts i afsnit 4 i kravspec. |
| 5 | REST Countries hentes og caches af appen | **REST Countries v5 via serveren** (`enrich.countries`), cachet i appens SQLite. Danske landenavne og flag ligger i `packages/shared` | v1–v4 (inkl. v3.1) er lukket (4. nov. 2026), og v5 kræver en API-nøgle (`REST_COUNTRIES_API_KEY`), som kun må ligge på serveren. Nøglen er valgfri: uden den vises land og flag, men ikke valuta og sprog. Fordi landelisten ligger i appen, kan en rejse oprettes offline. |
| 6 | Udvikling kræver net til dev-bucket'en (afsnit 9) | **Lokal billedlagring i udvikling**, når `S3_*` ikke er sat: filer under `apps/server/.data/media`, udleveret via HMAC-signerede links med 15 minutters levetid (`GET /api/media/*`) | Hele upload-flowet kan testes, før S3-udbyderen er valgt. Kun når `NODE_ENV=development`; i drift uden S3 svarer upload 503. URL'erne er relative, og appen sætter sin server-adresse foran. |
| 7 | Eget kamera med `expo-camera` (afsnit 5) | **Telefonens eget kamera** (`ImagePicker.launchCameraAsync`) **og upload fra albummet** (besluttet 16. nov. 2026) | Bedre billedkvalitet og en kamera-app, brugeren kender. Rejse og position vises derfor på skærmen efter billedet, ikke i søgeren. `expo-camera` er ikke installeret. På Android hentes et billede, hvis appen blev lukket, mens kameraet var åbent (`getPendingResultAsync`). |
| 8 | Wireframes' udseende og fem faner med flydende "+" | **Redesign D i postkort-stil** (besluttet 16. nov. 2026): papir, blæk og poststempel-rød, Fraunces, Inter og IBM Plex Mono. Fire faner med "+" i midten af bundbaren, profilen som avatar i headeren | Tokens og fælles komponenter ligger i `apps/native/lib/theme.ts`. Nye skærme skal følge stilen. |

Følgende tekst i kravspecifikationen skal opdateres:
- **Afsnit 2, API/backend:** "Eget REST-API i Fastify" → "Eget API i Fastify med tRPC (Zod-validering) og en REST-route til billedupload".
- **Afsnit 2, Begrundelse:** "Fastify har indbygget validering af input med JSON-schema" → "tRPC deler typerne mellem app, web og backend, og Zod validerer input".
- **Afsnit 2, Cloud-lagring:** "S3-kompatibel lagring (MinIO)" → "Hetzner Object Storage (S3-kompatibel)"; kun backend og database kører i Docker Compose.
- **Afsnit 4, Sikkerhed:** "Hvert API-endpoint i Fastify" → "Hver tRPC-procedure og upload-routen".
- **Afsnit 6:** uge 1 "Docker Compose med PostgreSQL og MinIO" → "Docker Compose med PostgreSQL og S3-bucket hos udbyder"; uge 2 "billedupload til MinIO" → "billedupload til S3".

### 0.1 S3-udbyder: Hetzner Object Storage (besluttet 9. nov. 2026)

Koden er stadig udbyder-neutral (AWS SDK v3), så et skift kun kræver nye miljøvariabler.

- **Placering:** en af Hetzners EU-placeringer: `fsn1` (Falkenstein), `nbg1` (Nürnberg) eller `hel1` (Helsinki). Billederne er persondata, så de bliver i EU.
- **URL'er:** virtual-hosted (`S3_FORCE_PATH_STYLE=false`), dvs. `https://<bucket>.fsn1.your-objectstorage.com/<nøgle>`.
- **Buckets:** private, én til dev og én til prod. Bucket-navne er unikke på tværs af alle Hetzner-kunder, så der skal måske et suffiks på.
- **Nøgler:** S3-nøgler oprettes under *Security → S3 credentials* og gælder for alle buckets i Hetzner-projektet. Skal en lækket dev-nøgle ikke kunne røre prod-billederne, skal prod-bucket'en ligge i sit eget Hetzner-projekt med egne nøgler.
- **Checksums:** SDK v3 sender som standard nye checksum-headere, som ikke alle S3-kompatible udbydere accepterer. Klienten er sat til `WHEN_REQUIRED` (`apps/server/src/storage.ts`).

Miljøvariabler i `apps/server/.env` (se `.env.schema`; nøglerne er `@sensitive`):

```
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_BUCKET=rejsepost-dev-xxxx        # rejsepost-prod-xxxx i drift
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
```

**Røgtest:** `npm run s3:smoke -w server` lægger et objekt op, henter det via et signeret link, tjekker at et usigneret link giver 403 (bucket'en er privat) og sletter det igen.

Variablerne skal også tilføjes `globalEnv` i `turbo.json`. Nøglerne ligger kun på serveren og aldrig i appen eller i Git (sikkerhedsrisiko 2 i kravspec).

---

## 1. Arkitektur

```
apps/native  (Expo, expo-router, expo-sqlite)  ──┐
apps/web     (Next.js)                         ──┼─ tRPC + /api/auth/* + /api/uploads ──► apps/server (Fastify)
                                                 │                                             │
                                                 │                    ┌────────────────────────┼─────────────────────┐
                                                 │                    ▼                        ▼                     ▼
                                                 │            PostgreSQL (Prisma)   S3-kompatibel bucket   Open-Meteo / Nominatim /
                                                 │              (Docker)            (ekstern, privat)      REST Countries
packages/api     tRPC-routere + adgangstjek
packages/auth    Better Auth-konfiguration (expo-plugin)
packages/db      Prisma-skema og -klient
packages/shared  (ny) Zod-skemaer, konstanter og typer, som app, web og server deler
packages/ui      shadcn-komponenter til web
```

### Billedflow

1. **Upload** sker via `POST /api/uploads` på Fastify (`@fastify/multipart`). Serveren tjekker sessionen og medlemskab af rejsen og validerer filtype (JPEG/PNG/HEIC→JPEG) og størrelse (fx maks. 15 MB). Derefter bruger den `sharp` til at fjerne EXIF og lave en thumbnail og lægger begge filer i bucket'en med `PutObject`. Svaret er en `mediaId`.
   *Hvorfor via serveren og ikke presigned PUT?* Validering af type og størrelse kan håndhæves ens hos alle udbydere (fx understøtter R2 ikke POST-policies), bucket'en behøver ingen CORS-opsætning, og EXIF kan fjernes centralt.
2. **Visning:** API'et returnerer **presigned GET-URL'er** med fx 15 minutters levetid i `posts.list`/`posts.get`, og kun hvis brugeren er medlem af rejsen (sikkerhedsrisiko 1).
3. **Objektnøgler** har formen `trips/{tripId}/{postId}/{mediaId}.jpg` og `…/{mediaId}_thumb.jpg`. Når et indlæg slettes, slettes de tilhørende objekter også.

### Berigelse (sted, vejr og land)

- `enrich.preview({ lat, lon, takenAt })` er en tRPC-query, som opret-skærmen bruger, når der er net. Serveren kalder:
  - **Nominatim (OpenStreetMap) reverse geocoding.** Kaldet går gennem serveren, fordi Nominatims brugspolitik kræver en identificerende User-Agent og maks. 1 forespørgsel pr. sekund. Svar caches på afrundede koordinater.
  - **Open-Meteo forecast-API** med `start_date`/`end_date` og hourly `temperature_2m`, `weather_code` og `wind_speed_10m`. Den time, der passer til `takenAt`, vælges, så det også virker for indlæg, der synkroniseres dage senere.
- **REST Countries:** appen henter listen over lande én gang (felterne navn, cca2, valuta, sprog, flag) og cacher den i SQLite. Serveren har samme cache til webversionen.
- Hvis et indlæg oprettes offline, gemmes kun `lat`, `lon` og `takenAt`. `posts.create` beriger på serveren, når felterne mangler, så vejr og stednavn bliver udfyldt ved næste synkronisering.

---

## 2. Datamodel

### Server (Prisma, `packages/db/prisma/schema/`)

```prisma
model Trip {
  id          String       @id @default(uuid())
  name        String
  countryCode String       // ISO 3166-1 alpha-2
  startDate   DateTime
  endDate     DateTime
  inviteCode  String?      @unique   // Should: grupperejser
  ownerId     String
  members     TripMember[]
  posts       Post[]
  createdAt   DateTime     @default(now())
}

model TripMember {
  tripId   String
  userId   String
  role     String   @default("member") // owner | member
  joinedAt DateTime @default(now())
  @@id([tripId, userId])
}

model Post {
  id          String    @id          // UUID genereret i appen → idempotent upload
  tripId      String
  authorId    String
  text        String    @db.VarChar(500)
  takenAt     DateTime
  lat         Float?
  lon         Float?
  placeName   String?
  weather     Json?     // { tempC, code, windKmh }
  countryCode String?
  media       Media[]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime? // soft delete, så andre klienter opdager sletningen
}

model Media {
  id        String @id @default(uuid())
  postId    String?
  kind       String  // photo | video (Could)
  key        String  // .jpg, eller .mp4 for video
  thumbKey   String? // thumbnail, eller plakatramme for video
  mimeType   String
  sizeBytes  Int
  width      Int?
  height     Int?
  durationMs Int?    // kun video
}
```

Relationerne til `User` fra Better Auths `auth.prisma` tilføjes. Migrationer køres med `npm run db:migrate`, ikke `db:push`, så de kan genskabes ved deploy.

### App (expo-sqlite)

Tabeller: `trips`, `posts` (samme felter + `syncStatus`, `localImageUri`, `remoteMediaId`, `lastError`, `attempts`, `updatedAt`, `pendingOp` og for video `mediaKind`, `localThumbUri`, `durationMs`), `countries` (cache) og `meta`. Migrationer styres med `PRAGMA user_version` (nu v3). Billeder og videoer kopieres til `FileSystem.documentDirectory/images/`.

`syncStatus`: `lokal → uploader → synkroniseret`, plus `fejl`, som prøves igen med backoff.

---

## 3. Synkronisering (upload-kø)

1. **Gem indlæg:** skriv til SQLite med `syncStatus = 'lokal'` og kopiér billedet til appens mappe. Dette sker altid, også når der er net.
2. **Køen kører** når appen starter, når `expo-network` melder online igen, når appen kommer i forgrunden, og lige efter et nyt indlæg er gemt.
3. Køen tager ét indlæg ad gangen: sæt status `uploader`, upload billedet til `/api/uploads` (gem `remoteMediaId` lokalt, så billedet ikke uploades igen ved retry), kald derefter `posts.create({ id, …, mediaId })` og sæt status `synkroniseret`. Opdatér lokale felter med de berigede data fra svaret.
4. **Idempotens:** `posts.create` er en upsert på det UUID, appen har genereret, så en retry aldrig giver dubletter.
5. **Konflikter:** "seneste ændring vinder" ud fra `updatedAt`. Det er nok, fordi man kun kan redigere sine egne indlæg.
6. **Hent fra server:** `posts.list({ tripId, since })` henter andres indlæg (grupper) og flettes ind i SQLite. Der er ingen fuld tovejs-synkronisering (jf. risikoanalysen).
7. **UI:** pillen "N venter på upload" i headeren, et statusikon på hvert kort og stiplet ramme på indlæg, der ikke er uploadet (jf. wireframes).

---

## 4. API (tRPC-routere i `packages/api`)

| Router | Procedurer | Adgang |
|---|---|---|
| `trips` | `list`, `get`, `members`, `create`, `update`, `delete` | `protectedProcedure`; `get/members/update/delete` via `tripMemberProcedure` (`update/delete` kun ejer) |
| `posts` | `list({tripId, since?})`, `get`, `create` (upsert), `update`, `delete` | `tripMemberProcedure`; `update/delete` kun forfatteren |
| `enrich` | `preview({lat, lon, takenAt})`, `searchPlaces({query, countryCode?})`, `countries` | `protectedProcedure` + rate limit |
| `invites` (Should) | `createCode(tripId)`, `revokeCode(tripId)`, `join(code)` | ejer / `protectedProcedure` + 10 forsøg pr. bruger og 20 fejl pr. IP pr. 10 min. |
| REST `POST /api/uploads` | multipart: `tripId`, `mediaId`, `kind` (`photo`/`video`), `file` | session + medlemskab |

**Fælles adgangs-middleware:** `tripMemberProcedure` læser `tripId` fra input, slår `TripMember` op og kaster `FORBIDDEN`/`NOT_FOUND`. Alle procedurer, der rører rejsedata, skal bygge på den (risiko 3 i risikoanalysen). Upload-routen genbruger den samme funktion `assertTripMember(userId, tripId)`.

**Øvrig sikkerhed:**
- Rate limiting på `/api/auth/*` (Better Auths indbyggede `rateLimit`) og på `enrich`/upload (`@fastify/rate-limit`).
- Zod-skemaer i `packages/shared` (tekst ≤ 500 tegn, datoer, invitationskodens format `^[A-Z0-9]{6}$`) bruges både i appen og på serveren.
- `onError` returnerer generiske fejlbeskeder, og detaljer logges kun på serveren.
- Prisma beskytter mod SQL-injection.
- HTTPS via reverse proxy med TLS foran containerne.

---

## 5. App: navigation og skærme

Ruter (expo-router), som de ser ud nu:

```
app/
  _layout.tsx                  auth-gate (session fra expo-secure-store)
  +not-found.tsx               sender videre til login
  (auth)/sign-in.tsx, sign-up.tsx
  (app)/_layout.tsx            stack over fanerne
  (app)/(tabs)/_layout.tsx     responsiv navigation (se nedenfor)
  (app)/(tabs)/index.tsx       Tidslinje (valgt rejse eller "Alle rejser")
  (app)/(tabs)/gallery.tsx     Galleri
  (app)/(tabs)/map.tsx         Kort (Should)
  (app)/(tabs)/trips.tsx       Rejser
  (app)/profile.tsx            Profil / synkronisering / log ud (åbnes fra avataren)
  (app)/post/add.tsx           Ark fra "+": tag et billede eller vælg fra album
  (app)/post/new.tsx           Gemt-skærm: tekst, rejse, sted og vejr
  (app)/post/place.tsx         Sæt sted (kort + stedsøgning)
  (app)/post/[id].tsx          Detalje
  (app)/post/edit/[id].tsx     Redigér tekst
  (app)/trip/new.tsx           Opret rejse
  (app)/trip/switch.tsx        Rejsevælger (ark fra headeren)
  (app)/trip/join.tsx          Tilslut med invitationskode
  (app)/trip/invite/[id].tsx   Invitationskode (ejer)
  (app)/trip/members/[id].tsx  Gruppen
  (app)/viewer/[postId].tsx    Fuldskærm med swipe
```

**Responsiv navigation:** `expo-router/ui` (headless `Tabs`, `TabList`, `TabSlot`) og en `useBreakpoint()`-hook baseret på `useWindowDimensions`:
- **< 600 dp:** bundbar med fire faner (Tidslinje, Galleri, Kort, Rejser) og "+" i midten. Galleriet har 3 kolonner.
- **600–840 dp:** sidebar i venstre side med "+" øverst. Galleriet har 5–6 kolonner.
- **> 840 dp:** sidebar + master/detail. Listen er til venstre, og det valgte indlæg/billede vises til højre i samme skærm, så der ikke navigeres.

Profilen er en avatar i headeren, og rejsen skiftes i et ark fra headeren.

Maks. tre tryk fra start til gemt indlæg: "+" → "Tag et billede" → udløseren i systemkameraet. Billedet gemmes med det samme i den aktive rejse, og tekst kan skrives bagefter. Fra albummet kan man vælge op til 20 billeder på én gang.

**Native moduler**, som installeres med `npx expo install`: `expo-image-picker` (systemkamera og album, se afsnit 0, punkt 7), `expo-location`, `expo-sharing`, `expo-sqlite`, `expo-file-system`, `expo-image`, `@maplibre/maplibre-react-native` og til Could-features `expo-video`, `expo-video-thumbnails`, `react-native-view-shot` og `expo-keep-awake`.
Kamera- og lokationstilladelser beder kun om "mens appen bruges" og spørges først, når funktionen bruges. Danske tekster sættes i `app.json` (`NSCameraUsageDescription` osv.).

**Web (Should):** Next.js-appen genbruger tRPC-routerne og viser rejseoversigt, tidslinje og galleri som master/detail. Den skal kun kunne læse; der oprettes ikke indlæg på web.

---

## 6. Tidsplan

### Uge 1: Opsætning, UI og navigation
**Mål:** prototype med login og navigation, hvor indlæg gemmes lokalt.

| Dag | Opgaver |
|---|---|
| Man | Vælg S3-udbyder og opret buckets (dev/prod, private) + API-nøgler. Opdatér kravspec (afsnit 0). Tilføj `db`-service (Postgres + volume) til `docker-compose.yml`, og lad `server` afhænge af den. Udfyld `.env`-filer og tilføj S3-variabler i `.env.schema`. |
| Tir | Prisma-skema (Trip, TripMember, Post, Media) + første migration. `packages/shared` med Zod-skemaer. Tjek at Better Auth-login virker i app og web. Lav en development build (`expo-dev-client`) og installér den på en fysisk telefon. |
| Ons | Ryd scaffoldets demo-skærme. Lav auth-gate, responsiv navigation (`useBreakpoint`, bundbar/sidebar) og skærmene Rejser, Tidslinje, Detalje og Profil med dummydata. |
| Tor | Opret indlæg-skærmen: `expo-camera`/`expo-image-picker` og `expo-location` (kun "mens appen bruges"). SQLite-skema, migrationer og lokal lagring af indlæg og billeder. |
| Fre | Tidslinjen og "opret rejse" kører på SQLite-data. S3-klienten (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) laves og røgtestes mod dev-bucket'en. Buffer. |

**Færdig når:** man kan logge ind på en fysisk telefon, oprette en rejse og et indlæg med billede og GPS, og indlægget ligger i SQLite og vises i tidslinjen uden net.

### Uge 2: API, upload og offline
**Mål:** MVP med alle Must have-funktioner.

| Dag | Opgaver |
|---|---|
| Man | `tripMemberProcedure` + `trips`- og `posts`-routerne. Integrationstest med to testbrugere, der ikke må kunne se hinandens rejser eller billeder. |
| Tir | `POST /api/uploads` (multipart, validering, `sharp`: EXIF-fjernelse og thumbnail, `PutObject`). Presigned GET-URL'er i `posts.list`/`get`. Rate limiting. |
| Ons | `enrich.preview` (Nominatim + Open-Meteo, med cache) og berigelse i `posts.create`. Cache af REST Countries i appen. Visning af sted, vejr og land på opret-skærmen og detaljen. |
| Tor | Upload-kø: statusovergange, idempotent upsert, retry med backoff, trigger ved `expo-network`. Statuspille og ikoner i UI. Hentning af andres indlæg (`since`). |
| Fre | Galleri (3/5–6 kolonner) + fuldskærmsviewer med swipe. Master/detail på store skærme. Test i flytilstand. Buffer. |

**Færdig når:** alle Must-krav i kravspecifikationens afsnit 3 kan demonstreres, inklusive at et indlæg oprettet i flytilstand bliver uploadet automatisk og får vejr og stednavn, når forbindelsen kommer tilbage.

### Uge 3: Kvalitet og afslutning
**Mål:** færdig app, testdokumentation og præsentation.

| Dag | Opgaver |
|---|---|
| Man | Deploy: Docker-images for `server` og `web` + Postgres på serveren, reverse proxy med TLS, prod-env (inkl. S3-nøgler til prod-bucket'en), `prisma migrate deploy`. Should-features efter prioritet: **1)** redigér/slet egne indlæg, **2)** grupperejser med invitationskode, **3)** galleri-filter (dag/person). |
| Tir | Should-features, fortsat: **4)** Next.js-webvisning, **5)** kortvisning. Brugertest med mindst én medstuderende (tre-tryk-flowet, upload-status og forståelse af offline). |
| Ons | Rettelser efter brugertesten. Testmatrix (se afsnit 7). README (opsætning, env, S3-udbyder, deploy). Could-features kun hvis der er tid tilbage. |
| Tor | Præsentation. |
| Fre | Fremlæggelse. |

---

## 7. Test

| Område | Hvordan |
|---|---|
| Adgangskontrol | Automatiserede tests (Vitest) mod tRPC-routerne og upload-routen: bruger B får `FORBIDDEN` på bruger A's rejse, indlæg og upload. Presigned URL'er udløber. |
| Offline | Manuelt: flytilstand → opret 3 indlæg → genstart appen → slå net til → alle bliver synkroniseret uden dubletter, og vejr og stednavn bliver udfyldt. |
| Layouts | Lille telefon, stor/foldbar telefon, tablet og Next.js i browser, i både portræt og landskab. Tjek bundbar/sidebar/master-detail og antal kolonner i galleriet. |
| Sikkerhed | Ingen hemmeligheder i Git (`git grep` efter nøgler), bucket'en er privat (direkte objekt-URL giver 403), EXIF er fjernet fra uploadede billeder og postkort, og rate limit på login giver 429. |
| Brugervenlighed | Brugertest i uge 3, hvor observationer og rettelser dokumenteres. |

---

## 8. Should/Could: implementeringsnoter

- **Grupperejser:** ejeren genererer en kode på 6 tegn (`invites.createCode`), og andre tilslutter sig med `invites.join(code)`, hvilket opretter en `TripMember`. Rate limit på `join`, så koder ikke kan gættes.
- **Filter i galleriet:** gruppér efter `takenAt`-dato og filtrér på `authorId`. Det kan gøres lokalt i SQLite.
- **Kort:** MapLibre (`@maplibre/maplibre-react-native`) med OpenStreetMap-tiles og markører for indlæg, der har `lat`/`lon`. Ingen API-nøgle (Google Maps, som `react-native-maps` bruger på Android, kræver en). På web bruges Leaflet + OSM-tiles.
- **Redigér/slet:** kun forfatteren, sletning sker som soft delete med `deletedAt`, og S3-objekterne slettes.
- **Video (Could, lavet):** `expo-image-picker` med `videoMaxDuration: 30`, `Media.kind = 'video'`, en størrelsesgrænse på upload og `expo-video` til afspilning. Serveren fjerner videoens metadata (GPS) med ffmpeg. Se status 16. nov.
- **Postkort (Could, lavet):** gengiv billede, tekst og sted med `react-native-view-shot` og del med `expo-sharing`. Det gengivne billede har ingen EXIF/GPS (sikkerhedsrisiko 3).
- **Diasshow (Could, lavet):** fuldskærmsviewer med autoplay-timer.

---

## 9. Risici (opdateret)

| Risiko | Håndtering |
|---|---|
| Valget af S3-udbyder forsinker uge 1 | Afgjort 9. nov.: Hetzner Object Storage. Koden er udbyder-neutral, så et skift kun kræver nye env-værdier. |
| Der er ingen lokal storage-container, så udvikling kræver net til bucket'en | Brug en separat dev-bucket. Upload-koden testes isoleret med en mock af S3-klienten. |
| Udbyderens S3-kompatibilitet afviger (path-style, checksums, POST-policy) | Kun basale operationer bruges (`PutObject`, `GetObject` presign, `DeleteObject`), og `S3_FORCE_PATH_STYLE` er konfigurerbar. |
| Uploads gennem serveren belaster båndbredden | Billederne komprimeres i appen før upload (fx max 2048 px, JPEG 0.8). Det er tilstrækkeligt i denne skala. |
| Nominatims rate limit | Kald går gennem serveren med cache og kø (1 req/s). Hvis det fejler, vises "Sted hentes senere". |
| Risici fra kravspecifikationen (stak med mange dele, offline-kompleksitet, manglende adgangstjek, native moduler, grupper/video) | Håndteres som beskrevet i kravspec afsnit 5 og ovenfor (fælles middleware, simpel kø, development build fra dag 2). |

---

## 10. Status

### 4. nov. 2026: uge 1 påbegyndt

**Lavet**
- `docker-compose.yml` har nu en `db`-service (Postgres 17 + volume), og `server` venter på den. Lokal udvikling: `docker compose up -d db`.
- S3-variabler (`S3_*`) og `REST_COUNTRIES_API_KEY` er tilføjet `apps/server/.env.schema` og `turbo.json`. De er valgfri, indtil udbyder og nøgle er valgt.
- Prisma-skema (Trip, TripMember, Post, Media) og første migration `20261104190202_init`.
- `packages/shared`: Zod-skemaer, konstanter, vejrkoder på dansk og en landeliste med danske navne.
- `packages/api`: `tripMemberProcedure`/`tripOwnerProcedure`, `trips`, `posts` (idempotent upsert og soft delete) og `enrich` (Nominatim + Open-Meteo med cache og 1 req/s, samt REST Countries v5). Fejl uden tekniske detaljer.
- `apps/server`: S3-klient (`src/storage.ts`, AWS SDK v3, udbyder-neutral) koblet på context.
- `apps/native`: auth-gate, danske login- og opret-konto-skærme, responsiv navigation (bundbar < 600 dp, sidebar fra 600 dp, master/detail > 840 dp), tidslinje, detalje, galleri grupperet pr. dag, rejser, profil, opret rejse og opret indlæg (kamera/galleri, GPS, EXIF-position for galleribilleder, forhåndsvisning af sted og vejr). Alt gemmes i SQLite pr. bruger (`lib/local-db`), og billederne kopieres til appens dokumentmappe.

**Verificeret**
- Typecheck af alle pakker.
- `expo export --platform android` bundler.
- Røgtest mod lokal server: to brugere kan ikke se hinandens rejser eller indlæg (NOT_FOUND), retry af `posts.create` giver ingen dublet, og berigelsen returnerede stednavn og vejr.

**Mangler / næste skridt**
- Vælg S3-udbyder og opret buckets (afsnit 0.1). Opret evt. en REST Countries-nøgle.
- Development build på fysisk telefon (`npx expo run:android` / `run:ios`). Appen er ikke kørt på en enhed endnu.
- Datofelterne i "Ny rejse" er tekstfelter (dd.mm.åååå). De kan skiftes til native datovælgere senere.
- Kortfanen viser kun en status, indtil kortvisningen (Should) laves.

### 4. nov. 2026: uge 2

**Lavet**
- `POST /api/uploads` (`apps/server/src/routes/uploads.ts`): session og medlemskab tjekkes, filtype og størrelse valideres (indholdet tjekkes med sharp, ikke kun klientens mimetype), EXIF/GPS fjernes, og der laves en thumbnail på 480 px. Uploaden er idempotent på et `mediaId` fra appen (= indlæggets id).
- Rate limiting: login/opret konto højst 5 pr. minut pr. IP (Better Auth; IP'en sættes af serveren ud fra `request.ip`), tRPC 300 pr. minut og upload 60 pr. minut (`@fastify/rate-limit`). Bag en proxy skal `TRUST_PROXY` sættes (se sikkerhedsrettelserne nedenfor).
- Serveren er delt op i `app.ts` (`buildApp`, testbar) og `index.ts` (opstart).
- Upload-kø og synkronisering i appen (`lib/sync/`): rejser oprettet offline sendes først, derefter indlæg ét ad gangen (billede → `posts.create`). Netværksfejl lægger indlægget tilbage i køen uden at tælle forsøg; serverfejl giver backoff (15 s → maks. 30 min). Andres indlæg hentes og flettes ind, slettede fjernes. Kører ved opstart, når nettet kommer tilbage, når appen kommer i forgrunden, efter "Gem indlæg", hvert minut (for backoff) og ved pull-to-refresh.
- Billeder fra serveren caches i expo-image på indlæggets id, så de ikke hentes igen, når de signerede links skifter, og kan vises offline.
- Fuldskærmsviewer med swipe (`app/(app)/viewer/[postId].tsx`), åbnes fra galleriet og fra detaljevisningen.
- Profilen viser synkroniseringsstatus og har en "Synkronisér nu"-knap.

**Tests** (`npm run test`, kræver `docker compose up -d db`; bruger databasen `rejsedagbog_test`)
- `access-control`: to brugere; alle procedurer og upload giver NOT_FOUND/401 for ikke-medlemmer.
- `posts`: idempotent oprettelse, kun forfatteren kan redigere/slette, tombstones via `since`.
- `uploads`: EXIF/GPS fjernes, størrelse 2048/480 px, idempotens, falske billeder (415), for store filer (413).
- `rate-limit`: 429 efter 5 forkerte logins, og IP-headeren kan ikke forfalskes.
- `sync.e2e`: appens synkroniseringsmotor mod den rigtige server med node:sqlite: offline → online uden dubletter, backoff uden ny billed-upload, ugyldige indlæg blokerer ikke køen, andres indlæg hentes og fjernes igen, udløbet session.
- Kontrol: med adgangstjekket slået fra fejler 9 af testene.

**Mangler**
- Appen er stadig ikke kørt på en enhed. Manuel flytilstands-test (afsnit 7) mangler.
- S3-udbyder er ikke valgt (den lokale lagring dækker udvikling).
- Uge 3: deploy, Should-features (redigér/slet i appen, invitationskoder, galleri-filter, web, kort).

### 4. nov. 2026: sikkerhedsrettelser

- **Klient-IP bag proxy:** `trustProxy` var `true` i produktion, så klienten kunne omgå al IP-baseret rate limiting med en falsk `X-Forwarded-For`. Nu styres det af `TRUST_PROXY`, som skal være proxyens IP/CIDR. **Skal sættes ved deploy.** Uden den deler alle brugere samme grænse, og serveren advarer ved opstart. `true` og antal hop stopper opstarten: Fastify 5.12 ignorerer antal hop, fordi det ikke kan bekræfte, at forespørgslen kommer fra proxyen.
- **Slettede indlæg:** tekst, position, sted, vejr og land fjernes fra databasen ved sletning og sendes ikke ud i tombstones.
- **Køen til Nominatim:** højst 20 i kø og 3 pr. bruger, og hver kilde har en samlet deadline på 12 s. Ellers gemmes indlægget uden den oplysning. Der er ingen senere genberigelse, så et indlæg gemt under pres forbliver uden stednavn.
- **CSRF:** `POST /api/uploads` afviser forkert `Origin` (appen sender ingen), og cookien er `SameSite=Lax`. Kræver, at web og API ligger på samme site, hvilket deploy-planen lægger op til. Skal de ligge på forskellige domæner, skal det genovervejes.
- **Logs:** query-strenge logges ikke længere, og `enrich.preview` er en mutation, så koordinater ikke står i URL'er.

### 5. nov. 2026: første kørsel på en enhed (Android-emulator)

Development build på en Android 36-emulator. Hele kæden virker: opret konto, opret rejse, GPS, kamera, sted og vejr fra serveren, upload af indlæg og billede.

**Fejl fundet og rettet** (ingen af dem kunne fanges af testene, som kører i Node)
- Uden login endte appen på "Siden findes ikke" og kunne ikke komme til login. `+not-found` sender nu videre til login.
- Billed-upload fejlede på alle enheder: Expos `fetch` accepterer ikke React Natives `{ uri, name, type }` i FormData. Bruger nu `File` fra `expo-file-system`.
- Programfejl under synkronisering blev tolket som manglende net, så indlægget stod som "venter på upload" for altid. Nu tæller kun rigtige netværksfejl som offline (med test).
- Position: med Googles "Location Accuracy" slået fra viste Android en dialog hver gang, og der kom ingen position. Nu bruges `Accuracy.High` uden dialog.
- Windows: C++-builden stoppede på stier over 260 tegn. Løst med config-pluginet `plugins/with-short-cmake-paths.js`.

**Mangler**
- Manuel flytilstands-test (afsnit 7), test på en fysisk telefon og på iOS.
- Galleri, fuldskærmsviewer og visning af andres billeder er ikke afprøvet på en enhed.
- Appens skærme har ingen automatiske tests, så fejl som de to første fanges kun ved at køre appen.

### 9. nov. 2026: S3-udbyder valgt

- **Hetzner Object Storage** (afsnit 0.1). `.env.schema` har Hetzner-eksempler, og `npm run s3:smoke -w server` røgtester bucket'en.
- Bucket `rejsedagbog` i `hel1` er oprettet. Røgtesten er bestået: upload, signeret link (200), usigneret link (403, bucket'en er privat) og sletning.

**Mangler**
- ~~Upload fra appen mod Hetzner (indtil nu kun testet mod lokal disk).~~ Lavet, se nedenfor.
- Separat prod-bucket (gerne i eget Hetzner-projekt med egne nøgler) før deploy.

### 9. nov. 2026: MVP færdig (uge 2's "færdig når" er opfyldt)

Afprøvet i Android-emulatoren (API 36) mod den lokale server med Hetzner-bucket'en.

**Verificeret**
- **Upload til Hetzner fra appen:** original (2048 px-grænse) og thumbnail ligger i bucket'en. Signeret link giver 200 og udløber efter 15 min, usigneret link giver 403, og billederne har ingen EXIF/GPS.
- **Flytilstandstest (afsnit 7):** med flytilstand og uden forbindelse til serveren blev 3 indlæg oprettet ("Sted/Vejr hentes senere", stiplet ramme, "3 venter på upload"). Appen blev genstartet offline, og indlæggene var der stadig. Da nettet kom tilbage, blev de uploadet automatisk (3 uploads, 3 `posts.create`, ingen fejl), uden dubletter og med stednavn og vejr fra serveren.
- **Galleri og fuldskærmsviewer:** 3 kolonner grupperet pr. dag, swipe mellem billederne.
- **Andres billeder:** bruger B blev tilføjet rejsen direkte i databasen (invitationskoder er Should). B's indlæg blev hentet ved pull-to-refresh og vist i tidslinje, galleri og viewer med billede fra S3. Rejsen viser "2 i gruppen".

**Fejl fundet og rettet**
- **Alle svar med billed-URL'er gav 500 med S3:** varlocks lækagetjek fandt `S3_ACCESS_KEY_ID` i de signerede URL'er (`X-Amz-Credential`) og blokerede svaret. Nøgle-ID'et er ikke hemmeligt, så det er nu `@public` i `.env.schema`. Det er `S3_SECRET_ACCESS_KEY` stadig ikke. Fejlen var skjult, fordi udvikling og tests bruger lokal lagring.
- **Viewer viste forkert tekst og tæller:** vieweren åbnede på det rigtige billede, men viste "1 / N" og teksten fra første indlæg, fordi indekset blev sat, før listen var hentet. Det viste billede huskes nu på id.
- **Android-build på Windows:** reanimateds C++-build fejlede på stier over 260 tegn, fordi ninja i SDK'ens CMake 3.22.1 ikke kan lange stier. `plugins/with-short-cmake-paths.js` sætter nu CMake 3.31.6 (ninja 1.12) for alle moduler. Kræver `LongPathsEnabled` i Windows.

**Opsætning af udviklingsmiljø (fundet undervejs)**
- `apps/native/.env` skal have `EXPO_PUBLIC_SERVER_URL=http://localhost:3000`, og emulatoren skal have `adb reverse tcp:3000 tcp:3000`.
- En tom database kræver `npm run db:migrate:deploy -w @rejsedagbog/db`.
- Android SDK 37, build-tools 37.0.0, NDK 27.1.12297006 og CMake 3.31.6 skal være installeret i en SDK, man har skriveadgang til (her `%LOCALAPPDATA%\Android\Sdk`, sat som `ANDROID_HOME`). Gradle kan ikke installere i `Program Files (x86)`.

**Position måles, når billedet tages (rettet samme dag)**
- Før blev positionen kun hentet, når opret-skærmen åbnede, og en sidst kendt position på op til 2 minutter blev genbrugt. I et tog kunne et indlæg derfor få et sted flere km fra, hvor billedet blev taget.
- Nu bruges positionen fra skærmens åbning kun som estimat til forhåndsvisningen. Når der trykkes "Tag billede", startes en ny måling (sidst kendt position må højst være 10 s gammel), mens kameraet er åbent, og den erstatter estimatet. Har kameraet selv skrevet GPS i billedets EXIF, bruges den. Trykkes "Gem", før målingen er klar, ventes der højst 5 s; ellers gemmes estimatet. Ændres positionen, gemmes sted og vejr fra forhåndsvisningen ikke, og serveren beriger ved upload.
- Afprøvet i emulatoren med Androids GPS-test-provider: skærmen blev åbnet ved Vatikanet og billedet taget ved Trevi. Indlægget fik Trevis koordinater og "Piazza di Trevi, Rom". (Emulatorens `geo fix` er upålidelig til den slags tests: en position, der sendes, mens GPS'en er slukket, går tabt. Brug `adb shell cmd location providers set-test-provider-location gps --location LAT,LON`.)

### 9. nov. 2026: Should-features 1–3 (før deploy)

Besluttet at lave de tre første Should-features før deploy, så brugertesten kan omfatte grupperejser uden at rette i databasen.

**Lavet**
- **Redigér/slet egne indlæg (1):** "Redigér tekst" og "Slet" på egne indlæg i detaljevisningen (også i master/detail). Begge dele virker offline: ændringen gemmes i SQLite med det samme (ny kolonne `pendingOp`, lokal migration v2) og sendes af upload-køen med `posts.update`/`posts.delete` efter nye indlæg. En rettelse overskrives ikke af hentningen fra serveren, mens den venter. Et indlæg, der slettes før upload, sendes aldrig op. Serverfejl prøves igen, og afvisninger (FORBIDDEN/NOT_FOUND/BAD_REQUEST) droppes, så de ikke prøves for evigt. Sted, vejr og billede kan ikke redigeres, fordi de er målt, da billedet blev taget.
- **Oprydning i bucket'en:** `posts.delete` sletter nu også et billede, der blev uploadet, men aldrig koblet på et indlæg (fx hvis appen blev lukket mellem upload og `posts.create`).
- **Grupperejser med invitationskode (2):** `invites`-routeren (`createCode`, `revokeCode`, `join`). Koden er 6 tegn uden 0/O og 1/I og passer stadig til `^[A-Z0-9]{6}$`. Kun ejeren ser og styrer koden; `join` er idempotent og begrænset til 10 forsøg pr. bruger og 20 forkerte koder pr. IP pr. 10 minutter (i hukommelsen, se `services/attempt-limiter.ts`). IP-grænsen er nødvendig, fordi konti er billige: med kun en grænse pr. bruger kunne én IP oprette ~7.000 konti i døgnet og gætte ~10 mio. koder. IP-grænsen virker kun bag proxyen, når `TRUST_PROXY` er sat. I appen: "Tilslut" under Rejser og en invitér-knap på egne rejser med "Del kode" (systemets delemenu) og "Stop invitationer". Invitationer kræver net; resten af appen virker stadig offline.
- **Filter i galleriet (3):** filtrér på person og dag (vises kun, når der er mere end én at vælge mellem). Filtreringen sker i appen på de lokale data.

**Tests** (82 i alt, før 58)
- `invites`: kode på 6 tegn og samme kode ved næste kald, kun ejeren kan styre koden, medlemmer ser ikke koden, koden giver kun adgang til den ene rejse, idempotent join, ugyldigt format/ukendt kode, fjernet kode, 429 efter 10 forsøg pr. bruger og efter 20 forkerte koder fra samme IP (på tværs af konti).
- `access-control`: `invites.createCode`/`revokeCode` giver NOT_FOUND for ikke-medlemmer.
- `sync.e2e`: rettelse offline → sendt ved net, rettelse der fejler overskrives ikke af hentningen, rettelse før upload, sletning offline inkl. billede i bucket og lokal fil, sletning før upload sendes aldrig, forældreløst billede fjernes, andres indlæg kan ikke slettes (og kommer tilbage).

**Afprøvet i emulatoren:** rettelse af et indlæg (nået serveren), slet-dialogen, oprettelse af kode, tilslutning med forkert kode (fejlbesked) og rigtig kode, en ny bruger tilsluttet via API'et og vist som "3 i gruppen", personfilter og dagsfilter inkl. tom tilstand, stop af invitationer.

**Ikke lavet / kendte begrænsninger**
- Man kan ikke forlade en rejse, og ejeren kan ikke fjerne medlemmer.
- Antal i gruppen opdateres først ved næste hentning (hvert 5. minut eller ved pull-to-refresh).
- Grænserne på `join` ligger i hukommelsen og nulstilles ved genstart. Det er nok med én serverinstans.
- Koderne udløber ikke af sig selv; ejeren kan stoppe dem. Mulig forbedring: udløb efter fx 7 dage.

**Næste skridt:** deploy (uge 3 mandag), derefter Should-features 4) Next.js-webvisning og 5) kortvisning.

### 12. nov. 2026: deploy og kortvisning (Should 5)

**Deploy på Coolify**
- API: https://api.example.com, web: https://app.example.com, Postgres som Coolify-database (ikke offentlig). Migrationer køres ved hver opstart af API-containeren.
- Rettet undervejs: Prisma-klienten er gitignoreret og skal genereres i Docker-buildet (`prisma generate`), og runner-images skal have `curl`, fordi Coolifys healthcheck kører curl/wget i containeren.
- `TRUST_PROXY=10.0.0.0/24` (Coolifys interne net, hvor Traefik sidder). Serveren ser nu klientens rigtige IP, så IP-grænserne virker.
- Billeder bruger indtil videre dev-bucket'en; en prod-bucket er kun et env-skift.

**Kortvisning (5)**
- MapLibre med OpenStreetMap-tiles, så der ikke skal bruges en Google Maps-nøgle. Kræver et nyt dev-build (native modul). Hvert indlæg med position vises som en rund miniature (stiplet kant, hvis det ikke er uploadet). Tryk viser indlægget i et kort nederst (på stor skærm i højre side), og "Vis alle"-knappen zoomer ud til hele rejsen.
- OSM's brugsregler: synlig kreditering på kortet og en User-Agent, der identificerer appen (`TransformRequestManager.addHeader`). Ingen forudhentning af tiles.
- Offline vises de tiles, MapLibre har gemt fra tidligere visninger; resten er en neutral baggrund, og markørerne vises stadig, fordi de kommer fra SQLite.
- Expo web har en simpel erstatning (`trip-map.web.tsx`); kortet på web laves i Next.js med Leaflet.

**Hvem er med i gruppen**
- `trips.members` (kun for medlemmer) giver navn, rolle og hvornår de kom med. E-mails sendes ikke, så de andre i gruppen kun ser navnet.
- Skærmen "Gruppen" åbnes fra "N i gruppen" i headeren eller fra gruppe-ikonet ved hver rejse under Rejser. Ejeren kommer herfra videre til invitationskoden. Listen gemmes i SQLite og vises offline med "Viser gruppen, som den så ud sidst". Kaldet har en timeout på 8 s, så et dårligt net ikke får skærmen til at hænge. Antal i gruppen opdateres samtidig.
- Tests: 84 i alt (medlemsliste uden e-mails og med ejeren først; NOT_FOUND for ikke-medlemmer).

**"Alle rejser"**
- Under Rejser kan man vælge "Alle rejser". Så viser tidslinje, galleri, kort og fuldskærm indlæg fra alle rejser, og hvert indlæg er mærket med rejsens navn. Galleriet kan også filtrere på rejse.

**Kendte begrænsninger:** indlæg på samme sted ligger oven på hinanden (ingen klynger), og en rejse over datolinjen giver et forkert udsnit.

**Næste skridt:** Should 4) Next.js-webvisning (inkl. kort med Leaflet), APK til brugertesten med `EXPO_PUBLIC_SERVER_URL=https://api.example.com`.

### 16. nov. 2026: redesign, upload fra album og "Sæt sted"

**Sæt sted i hånden (API)**
- `posts.update` tager nu også `lat`/`lon`. Ændres positionen, henter serveren sted og vejr igen for det tidspunkt, hvor billedet blev taget.
- Ny `enrich.searchPlaces` søger efter steder via Nominatim, først i rejsens land og ellers overalt. Den bruger samme kø som stednavnene.
- Appen gemmer en ny position offline (`updatePostPosition`) og sender den med rettelsen. Sted og vejr fra serveren skrives tilbage.
- **Serveren skal deployes før appen.** En ældre server ignorerer positionen.
- Tests i `posts` og `sync.e2e`.

**Redesign D i postkort-stil (appen)**
- Hele appen følger redesign D (afsnit 0, punkt 8). Tidslinjen er grupperet i rejsedage, indlæg vises som postkort og rejser som frimærker.
- "+" åbner et ark med "Tag et billede" (systemkameraet) og "Vælg fra album" (op til 20 billeder). Billederne gemmes med det samme (D1/D2).
- Rejsevælger som ark fra headeren (D3) og en forklaring, før appen beder om placeringstilladelse (D4).
- **Position:**
  - Har kameraet været åbent i over 30 s, måles positionen igen.
  - Gamle albumbilleder uden GPS får ikke den nuværende position.
  - Billeder uden position kan få et sted på den nye skærm "Sæt sted" (kort og stedsøgning). Den åbnes fra gemt-skærmen og fra indlæggets handlinger.
- På Android hentes et billede ved næste start, hvis appen blev lukket, mens kameraet var åbent.

**Rettelser**
- Expo web: Metro bundler nu `.wasm` og sender COOP/COEP-headers, så expo-sqlite virker i browseren.
- Tidslinjen: dag-overskrifter fik samme key, når "Alle rejser" viste to rejser med billeder fra samme dag.
- "Brug min position" i "Sæt sted" kunne hænge med en spinner, hvis kaldet om tilladelse fejlede.
- `unstable_settings.initialRouteName` er skiftet til `anchor` (udfaset i Expo Router).

### 16. nov. 2026: Could-features (video, postkort, diasshow)

**Video (højst 30 s)**
- "+"-arket har fået "Optag en video" (systemkameraet med `videoMaxDuration: 30`). Albummet tager nu både billeder og videoer, og for lange eller for store videoer springes over med en besked.
- Appen gemmer videoen lokalt med en plakatramme (`expo-video-thumbnails`) og længden. SQLite v3 har kolonnerne `mediaKind`, `localThumbUri` og `durationMs`.
- Upload: appen sender `kind`. Serveren streamer videoen til en midlertidig fil og bruger ffmpeg (`ffmpeg-static`) til følgende:
  - Den validerer filen (kun mov/mp4-demuxeren, kun lokale filer).
  - Den kræver h264 eller hevc og højst 30 s.
  - Den fjerner al metadata, herunder GPS, og laver en plakatramme.
  - Billedsporet kopieres uden genkodning. Lyd, der ikke er AAC, genkodes til AAC; det gælder fx AMR fra Android-kameraer, som MP4 ikke kan rumme.
- Visning:
  - Afspil-mærke og længde i tidslinjen, galleriet og detaljen.
  - Fuldskærmsafspilning med `expo-video`.
  - Den lokale udviklingslagring understøtter Range-forespørgsler.
- Migration `20261116120000_media_duration` (`Media.durationMs`). Den køres ved opstart af containeren.

**Del som postkort**
- Detaljen har knappen "Del som postkort". Skærmen viser følgende som et papirkort:
  - billedet eller plakatrammen med poststempel;
  - "Hilsen fra" med stedet og teksten;
  - et frimærke med flag, dato, vejr og afsender.
- `react-native-view-shot` tager kortet som JPEG, og `expo-sharing` åbner systemets delemenu. Den delte fil har ingen EXIF eller GPS, kun stednavnet på kortet.

**Diasshow**
- Fuldskærmsvisningen har en "Start diasshow"-knap. Diasshowet viser billeder i 4 s hver, og videoer spilles færdige.
- Efter det sidste indlæg starter det forfra. Skærmen holdes tændt (`expo-keep-awake`), og et tryk stopper diasshowet.

**Test**
- 107 servertests består. Videotestene bruger rigtige ffmpeg-videoer og dækker:
  - GPS fjernes;
  - rotationen bevares;
  - længdegrænsen;
  - falske videoer;
  - AMR-lyd;
  - Range-forespørgsler;
  - synkronisering end-to-end, inkl. sletning.
- Afprøvet på Android-emulatoren (pixel_7, API 36) med nyt dev-build:
  - optagelse med systemkameraet;
  - upload og synkronisering;
  - afspilning;
  - diasshow med billeder og video;
  - deling af postkort.
- Rettet under afprøvningen:
  - Androids kamera-video med AMR-lyd blev afvist af serveren.
  - Plakatrammen fejlede lige efter kameraet; nu prøves der igen.
  - Diasshowet viste et sort glimt ved spring fra sidste til første side.

**Kendte begrænsninger**
- **Nyt build:** `expo-video`, `expo-video-thumbnails`, `expo-sharing`, `react-native-view-shot` og `expo-keep-awake` er native moduler, så der skal laves et nyt dev-build og en ny APK.
- **Rækkefølge ved deploy:** serveren skal deployes før appen. En ældre server ville gemme en video som billede.
- **Ingen genkodning af billedet:** HEVC-videoer fra iPhone kan måske ikke afspilles på ældre Android-telefoner, og 4K-videoer fylder meget (op til 200 MB).
- **Hukommelse:** serveren lægger hele den færdige video i hukommelsen ved upload til S3.
- **Udløbne links:** de signerede video-links udløber efter 15 min. En video, der har været åben længe, skal hentes igen ved at trække ned i tidslinjen.
- **Mikrofon på Android:** `RECORD_AUDIO` er blokeret, fordi systemets kamera-app selv optager lyden. iOS har en mikrofontekst i `app.json`.
- **Web:** video kan ikke optages, postkort kan ikke deles, og albummet tager kun billeder.

**Mangler (samlet pr. 16. nov.)**
- **Deploy:** serveren skal deployes, før en ny APK laves. Den skal have `posts.update`-positionen, `enrich.searchPlaces` og video-uploaden (ffmpeg og migrationen `media_duration`). Skift til en separat prod-bucket (gerne i eget Hetzner-projekt med egne nøgler).
- **Should 4) Next.js-webvisning:** `apps/web` har stadig kun scaffoldets login og dashboard. Den skal vise rejseoversigt, tidslinje og galleri som master/detail plus et kort med Leaflet og OSM, og den skal kun kunne læse.
- **Brugertest:** byg en APK med `EXPO_PUBLIC_SERVER_URL=https://api.example.com`, test med mindst én medstuderende, og lav og dokumentér rettelserne.
- **Testmatrix (afsnit 7):**
  - layouts på lille telefon, foldbar, tablet og web, i portræt og landskab.
  - en fysisk telefon og iOS.
  - sikkerhedstjek: søg Git igennem for nøgler (`git grep`) og tjek, at der ikke er EXIF på postkort.
  - Redesignet er ikke gennemtestet på alle tre layouts.
- **README:** "Deployment" er stadig scaffoldets Docker Compose-tekst. Den skal beskrive Coolify, env, `TRUST_PROXY` og Hetzner.
- **Kravspecifikationen:** tekstændringerne i afsnit 0 skal ind.
- **Præsentation og fremlæggelse.**
- **Could:** video, deling af postkort og diasshow er lavet (se ovenfor). De mangler kun at blive afprøvet på en fysisk telefon og iOS. Serveren med ffmpeg skal deployes før den nye APK.
- **Kendte begrænsninger, der ikke er planlagt:**
  - Man kan ikke forlade en rejse, og ejeren kan ikke fjerne medlemmer.
  - Invitationskoder udløber ikke.
  - Kortet laver ingen klynger.
  - En rejse over datolinjen giver et forkert kortudsnit.

**Næste skridt:** deploy serveren, og byg derefter APK'en til brugertesten. Should 4) webvisningen laves sideløbende.
