# Udviklingsplan – Rejsepost (Rejsedagbog)

Bygger på *Kravspecifikation – Rejsedagbog* (4. nov. 2026) og det Better-T-Stack-scaffold, der allerede ligger i repoet.
Planen følger kravspecifikationens tre uger og MoSCoW-prioritering. Must-krav udgør MVP'en, og Should/Could laves først, når MVP'en virker.

---

## 0. Ændringer i forhold til kravspecifikationen

| # | Kravspec siger | Ændres til | Begrundelse / konsekvens |
|---|---|---|---|
| 1 | Billeder i S3-kompatibel lagring **(MinIO)**, kørt i Docker Compose | **Ekstern, administreret S3-kompatibel lagring** (udbyder vælges, se 0.1) | Ingen storage-container i Compose. Backend taler S3-API via AWS SDK v3 med konfigurerbart endpoint, så udbyderen kan skiftes alene via miljøvariabler. Der bruges separate buckets til dev og prod. |
| 2 | Eget REST-API i Fastify med JSON-schema-validering | **tRPC på Fastify** med Zod-validering (sådan er scaffoldet sat op) + én almindelig REST-route til billedupload (multipart) | Typerne deles automatisk mellem app, web og backend, og Zod giver samme inputvalidering. tRPC håndterer ikke filupload godt, derfor er upload en separat Fastify-route. **Besluttet:** tRPC beholdes til alt andet end filer, billedupload går gennem en Fastify-route, og teksten i kravspec opdateres. |
| 3 | Backend, database og lagring kører i Docker Compose | Compose indeholder `server`, `web` og **`db` (PostgreSQL)**. Scaffoldet mangler db-servicen, så den tilføjes. | Lagring ligger nu uden for Compose (punkt 1). |
| 4 | – | Scaffoldets drawer- og tabs-navigation i `apps/native` erstattes af responsiv navigation (bundbar/sidebar) | Navigationen skal følge de tre layouts i afsnit 4 i kravspec. |
| 5 | REST Countries hentes og caches af appen | **REST Countries v5 via serveren** (`enrich.countries`), cachet i appens SQLite. Danske landenavne og flag ligger i `packages/shared` | v1–v4 (inkl. v3.1) er lukket (4. nov. 2026), og v5 kræver en API-nøgle (`REST_COUNTRIES_API_KEY`), som kun må ligge på serveren. Nøglen er valgfri: uden den vises land og flag, men ikke valuta og sprog. Fordi landelisten ligger i appen, kan en rejse oprettes offline. |
| 6 | Udvikling kræver net til dev-bucket'en (afsnit 9) | **Lokal billedlagring i udvikling**, når `S3_*` ikke er sat: filer under `apps/server/.data/media`, udleveret via HMAC-signerede links med 15 minutters levetid (`GET /api/media/*`) | Hele upload-flowet kan testes, før S3-udbyderen er valgt. Kun når `NODE_ENV=development`; i drift uden S3 svarer upload 503. URL'erne er relative, og appen sætter sin server-adresse foran. |

Følgende tekst i kravspecifikationen skal opdateres:
- **Afsnit 2, API/backend:** "Eget REST-API i Fastify" → "Eget API i Fastify med tRPC (Zod-validering) og en REST-route til billedupload".
- **Afsnit 2, Begrundelse:** "Fastify har indbygget validering af input med JSON-schema" → "tRPC deler typerne mellem app, web og backend, og Zod validerer input".
- **Afsnit 2, Cloud-lagring:** "S3-kompatibel lagring (MinIO)" → "ekstern S3-kompatibel lagring"; kun backend og database kører i Docker Compose.
- **Afsnit 4, Sikkerhed:** "Hvert API-endpoint i Fastify" → "Hver tRPC-procedure og upload-routen".
- **Afsnit 6:** uge 1 "Docker Compose med PostgreSQL og MinIO" → "Docker Compose med PostgreSQL og S3-bucket hos udbyder"; uge 2 "billedupload til MinIO" → "billedupload til S3".

### 0.1 Valg af S3-udbyder (åben beslutning)

Koden skrives udbyder-neutralt. Følgende skal afklares i uge 1, dag 1:

- **Udbyder**, fx Cloudflare R2, Hetzner Object Storage, Backblaze B2 eller AWS S3. Hos dem alle gælder: private buckets, presigned GET-URL'er og S3-API.
- **Region/datacenter**, gerne i EU, fordi billederne er persondata.
- **Path-style eller virtual-hosted URL'er**, som styres af `S3_FORCE_PATH_STYLE`.

Miljøvariabler i `apps/server/.env.schema` (varlock, alle `@sensitive` undtagen bucket og region):

```
S3_ENDPOINT=          # fx https://<account>.r2.cloudflarestorage.com
S3_REGION=            # fx auto / eu-central-1
S3_BUCKET=            # rejsepost-dev / rejsepost-prod
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=  # true/false
```

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
  kind      String  // photo | video (Could)
  key       String
  thumbKey  String?
  mimeType  String
  sizeBytes Int
  width     Int?
  height    Int?
}
```

Relationerne til `User` fra Better Auths `auth.prisma` tilføjes. Migrationer køres med `npm run db:migrate`, ikke `db:push`, så de kan genskabes ved deploy.

### App (expo-sqlite)

Tabeller: `trips`, `posts` (samme felter + `syncStatus`, `localImageUri`, `remoteMediaId`, `lastError`, `attempts`, `updatedAt`), `countries` (cache) og `meta`. Migrationer styres med `PRAGMA user_version`. Billeder kopieres til `FileSystem.documentDirectory/images/`.

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
| `trips` | `list`, `get`, `create`, `update`, `delete` | `protectedProcedure`; `get/update/delete` via `tripMemberProcedure` (`update/delete` kun ejer) |
| `posts` | `list({tripId, since?})`, `get`, `create` (upsert), `update`, `delete` | `tripMemberProcedure`; `update/delete` kun forfatteren |
| `enrich` | `preview({lat, lon, takenAt})`, `countries` | `protectedProcedure` + rate limit |
| `invites` (Should) | `createCode(tripId)`, `join(code)` | ejer / `protectedProcedure` |
| REST `POST /api/uploads` | multipart: `tripId`, `postId`, `file` | session + medlemskab |

**Fælles adgangs-middleware:** `tripMemberProcedure` læser `tripId` fra input, slår `TripMember` op og kaster `FORBIDDEN`/`NOT_FOUND`. Alle procedurer, der rører rejsedata, skal bygge på den (risiko 3 i risikoanalysen). Upload-routen genbruger den samme funktion `assertTripMember(userId, tripId)`.

**Øvrig sikkerhed:**
- Rate limiting på `/api/auth/*` (Better Auths indbyggede `rateLimit`) og på `enrich`/upload (`@fastify/rate-limit`).
- Zod-skemaer i `packages/shared` (tekst ≤ 500 tegn, datoer, invitationskodens format `^[A-Z0-9]{6}$`) bruges både i appen og på serveren.
- `onError` returnerer generiske fejlbeskeder, og detaljer logges kun på serveren.
- Prisma beskytter mod SQL-injection.
- HTTPS via reverse proxy med TLS foran containerne.

---

## 5. App: navigation og skærme

Ruter (expo-router):

```
app/
  _layout.tsx               auth-gate (session fra expo-secure-store)
  (auth)/sign-in.tsx, sign-up.tsx
  (app)/_layout.tsx         responsiv navigation (se nedenfor)
  (app)/index.tsx           Tidslinje (valgt rejse)
  (app)/gallery.tsx         Galleri
  (app)/map.tsx             Kort (Should)
  (app)/trips/index.tsx     Rejser + opret rejse
  (app)/profile.tsx         Profil / log ud
  post/new.tsx              Opret indlæg (modal)
  post/[id].tsx             Detalje
  viewer/[mediaId].tsx      Fuldskærm med swipe
```

**Responsiv navigation:** brug `expo-router/ui` (headless `Tabs`, `TabList`, `TabSlot`) og en `useBreakpoint()`-hook baseret på `useWindowDimensions`:
- **< 600 dp:** bundbar med fem faner og flydende "+"-knap. Galleriet har 3 kolonner.
- **600–840 dp:** sidebar i venstre side med "+" øverst. Galleriet har 5–6 kolonner.
- **> 840 dp:** sidebar + master/detail. Listen er til venstre, og det valgte indlæg/billede vises til højre i samme skærm, så der ikke navigeres.

Maks. tre tryk fra start til gemt indlæg: "+" → "Tag billede" → (skriv tekst) → "Gem indlæg". Rejsen er forvalgt som den aktive rejse.

**Native moduler**, som installeres med `npx expo install`: `expo-camera`, `expo-image-picker`, `expo-location`, `expo-sharing`, `expo-sqlite`, `expo-file-system`, `expo-image` (og senere `react-native-maps`, `react-native-view-shot`, `expo-video`).
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
- **Kort:** `react-native-maps` med markører for indlæg, der har `lat`/`lon`. På web bruges Leaflet + OSM-tiles.
- **Redigér/slet:** kun forfatteren, sletning sker som soft delete med `deletedAt`, og S3-objekterne slettes.
- **Video (Could):** `expo-image-picker` med `videoMaxDuration: 30`, `Media.kind = 'video'`, en størrelsesgrænse på upload og `expo-video` til afspilning.
- **Postkort (Could):** gengiv billede, tekst og sted med `react-native-view-shot` og del med `expo-sharing`. Det gengivne billede har ingen EXIF/GPS (sikkerhedsrisiko 3).
- **Diasshow (Could):** fuldskærmsviewer med autoplay-timer.

---

## 9. Risici (opdateret)

| Risiko | Håndtering |
|---|---|
| Valget af S3-udbyder forsinker uge 1 | Beslutningen tages mandag i uge 1. Koden er udbyder-neutral, så et skift kun kræver nye env-værdier. |
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
