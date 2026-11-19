# Rejsepost (rejsedagbog)

Rejsepost er en rejsedagbog til telefon og tablet. Man tager et billede på rejsen, og appen tilføjer selv sted, vejr og land. Indlæg kan laves uden internet og bliver sendt, når der er forbindelse igen. En rejse kan deles med dem, man rejser med, så alles billeder samles ét sted, og med familien derhjemme, som kun kan se med.

Appen er lavet til unge og voksne, der rejser sammen: studieture, venneture og familieferier. Den løser, at billederne ender spredt på flere telefoner, og at man bagefter ikke kan huske, hvor og hvornår de blev taget.

**Det kan appen**

- Oprette konto og logge ind med e-mail og adgangskode (Google og Apple er forberedt, men ikke sat op hos udbyderne).
- Oprette rejser med et eller flere lande, og oprette, se, rette og slette egne indlæg med billede eller video.
- Hente sted, vejr og landefakta automatisk ud fra billedets position og tidspunkt.
- Virke offline: indlæg gemmes på telefonen og synkroniseres senere.
- Vise rejsen som tidslinje, galleri og kort, og dele et indlæg som postkort.
- Tilpasse sig skærmen: bundbar på telefon, sidebar på tablet og liste med detalje ved siden af på store skærme. Lyst og mørkt tema følger telefonen.

Dokumentation: [docs/projektdokumentation.pdf](docs/projektdokumentation.pdf) (design, arkitektur, trusselsmodel, test og refleksion), [kravspecifikationen](Kravspecifikation%20-%20Rejsedagbog.pdf) og [docs/udviklingsplan.md](docs/udviklingsplan.md) (plan og status dag for dag).

## Teknologier

| Del | Teknologi |
|---|---|
| App (Android, iOS) | React Native 0.88 med Expo SDK 58 og Expo Router, TypeScript |
| Lokal lagring i appen | SQLite (`expo-sqlite`) til indlæg og upload-kø, `expo-secure-store` til login-tokenet |
| API | Fastify 5 med tRPC 11 og Zod-validering, samt en REST-route til upload af billeder og video |
| Login | Better Auth (e-mail og adgangskode, sessioner med udløb) |
| Database | PostgreSQL 17 med Prisma |
| Billeder | S3-kompatibel, privat bucket (Hetzner Object Storage) med signerede links på 15 minutter |
| Eksterne tjenester | Open-Meteo (vejr), Nominatim/OpenStreetMap (stednavne og kort), REST Countries (landefakta) |
| Web | Next.js 16 (kun login indtil videre) |
| Drift | Docker-images på Coolify bag Traefik med TLS |
| Monorepo og test | Turborepo, Vitest |

Arkitekturen er tegnet i [docs/arkitektur.svg](docs/arkitektur.svg).

## Roller

Roller gælder pr. rejse og håndhæves på serveren (`packages/api/src/trip-access.ts`). Appen skjuler knapper, man ikke må bruge, men det er kun for brugervenlighedens skyld.

| Rolle | Får man ved at | Må |
|---|---|---|
| **Ejer** (`owner`) | oprette rejsen | alt: rette og slette rejsen, lave og stoppe invitations- og delingskoder, se gruppen, lægge indlæg op |
| **Medrejsende** (`member`) | tilslutte sig med invitationskoden | se alt på rejsen, lægge egne indlæg op og rette og slette dem |
| **Kun visning** (`viewer`) | tilslutte sig med koden til deling | se rejsens indlæg og billeder, intet andet |
| Ikke med på rejsen | – | ingenting: serveren svarer, at rejsen ikke findes |

Ejeren er rejsens administrator. Der er ingen global administrator, fordi ingen skal kunne se andres private rejsebilleder.

## Kom i gang på en ny computer

Kræver Node.js, npm og Docker Desktop.

**1. Installér afhængigheder.** Det genererer også `src/env.ts` i hver app.

```bash
npm install
```

**2. Opret `.env`-filerne.** De er gitignored og skal laves på hver computer.

`apps/server/.env`:

```
BETTER_AUTH_SECRET=<mindst 32 tegn>
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rejsedagbog
```

En hemmelighed kan laves med `node -p "require('node:crypto').randomBytes(32).toString('hex')"`. Valgfrit: `S3_*`, `REST_COUNTRIES_API_KEY` samt `GOOGLE_*` og `APPLE_*` til login med Google og Apple (se `apps/server/.env.schema` og afsnit 8.1 i `docs/udviklingsplan.md`). Ved deploy bag en reverse proxy skal `TRUST_PROXY` sættes til proxyens IP/CIDR, fx `172.16.0.0/12` i et Docker-netværk. Uden S3 gemmes billeder lokalt i `apps/server/.data/media` under udvikling.

`apps/native/.env` (brug computerens LAN-IP, fordi `localhost` ikke virker fra en telefon):

```
EXPO_PUBLIC_SERVER_URL=http://<din-lan-ip>:3000
```

`apps/web/.env`:

```
NEXT_PUBLIC_SERVER_URL=http://localhost:3000
```

**3. Start databasen og opret tabellerne.**

```bash
docker compose up -d db
npm run db:generate
npx turbo run db:migrate:deploy -F @rejsedagbog/db
```

**4. Start serveren og appen.**

```bash
npm run dev:server
```

Start appen i en ny terminal med en af disse to:

```bash
cd apps/native
npx expo start --go       # Expo Go: scan QR-koden, ingen native build
npx expo run:android      # development build: kræver Android Studio/SDK og en tilsluttet telefon
```

Telefonen skal være på samme netværk som computeren, og firewallen skal tillade Node.js på port 3000 og 8081.

**5. Kør tests** (kræver, at databasen kører):

```bash
npm run test
npm run check-types
```

Video-testene bruger ffmpeg. Hvis de fejler med, at `ffmpeg.exe` mangler, har npm blokeret pakkens install-script; hent den med `node node_modules/ffmpeg-static/install.js`.

Data følger ikke med git: den lokale database og uploadede billeder findes kun på den computer, de blev lavet på.

`npm run dev` starter alle apps på én gang. Web-appen kører på [http://localhost:3001](http://localhost:3001) og API'et på [http://localhost:3000](http://localhost:3000).

Efter ændringer i Prisma-skemaet: `npm run db:migrate` og `npm run db:generate`.

## Byg appen til iOS og Android (EAS Build)

Appen bygges i skyen med [EAS Build](https://docs.expo.dev/build/introduction/), så iOS kan bygges uden en Mac. Profilerne står i `apps/native/eas.json`, og alle kommandoer køres fra `apps/native`.

| Profil | Resultat | Server |
|---|---|---|
| `development` | Development build (kræver Metro på computeren). `development-simulator` er det samme til iOS-simulatoren. | `apps/native/.env` |
| `preview` | Android: APK til direkte installation. iOS: ad hoc-build til registrerede enheder. | `EXPO_PUBLIC_SERVER_URL` i `eas.json` |
| `production` | Android: AAB til Google Play. iOS: build til TestFlight/App Store. Buildnummeret tælles selv op. | `EXPO_PUBLIC_SERVER_URL` i `eas.json` |

**Første gang** (kræver en Expo-konto):

```bash
npm install -g eas-cli
cd apps/native
eas login
eas init          # opretter EAS-projektet og skriver projectId i app.json
```

**Byg:**

```bash
eas build --profile preview --platform android      # APK til brugertest
eas build --profile preview --platform ios          # kræver Apple Developer-konto og `eas device:create`
eas build --profile production --platform all       # til butikkerne
eas submit --profile production --platform ios      # upload til TestFlight
eas submit --profile production --platform android  # upload til Google Play (intern test)
```

EAS opretter og gemmer selv signeringsnøglerne (Android keystore, iOS-certifikat og provisioning profile) ved første build. iOS kræver medlemskab af Apple Developer Program, og Google Play kræver en udviklerkonto, hvor den første AAB uploades i hånden i Play Console.

- **App-id:** `dev.leth.rejsepost` på begge platforme (`app.json`). Det kan ikke ændres, når appen først ligger i en butik.
- **Server-adresse:** `.env` er gitignored og kommer ikke med op til EAS. `EXPO_PUBLIC_SERVER_URL` står derfor i `eas.json` under hver profil og bages ind i appen, når den bygges.
- **Ikoner:** tegnes af `npm run icons -w native` (`apps/native/scripts/generate-icons.mjs`).
- **Tjek før et build:** `npx expo-doctor` og `npm run check-types`.

## Deploy

Serveren og web kører som Docker-images (`apps/server/Dockerfile`, `apps/web/Dockerfile`) på Coolify bag Traefik, som står for TLS og sender `http://` videre til `https://`.

- API og web har hvert sit domæne med HTTPS. Databasen er en Coolify-database, som ikke kan nås udefra.
- Migrationer køres ved hver opstart af API-containeren (`prisma migrate deploy`).
- Miljøvariabler sættes i Coolify, aldrig i Git: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN`, `DATABASE_URL`, `S3_*` og `TRUST_PROXY`. Alle er beskrevet i `apps/server/.env.schema`.
- `TRUST_PROXY` skal være proxyens IP eller CIDR (i Coolify det interne net, hvor Traefik sidder). Uden den ser serveren kun proxyens IP, og alle brugere deler samme rate limit.
- Serveren skal deployes før en ny app-version, når API'et er ændret.

Lokalt kan hele stakken startes med Docker Compose: `npm run docker:up` (stop med `npm run docker:down`).

## Sikkerhed og tjek for hemmeligheder

- Adgangskoder hashes af Better Auth med scrypt. Login-tokenet gemmes i telefonens Keystore/Keychain og udløber efter 7 dage uden brug.
- Hver tRPC-procedure, der rører en rejse, bygger på `tripMemberProcedure`, som slår medlemskabet op på serveren. Et ændret id i en forespørgsel giver "Rejsen findes ikke".
- Der er rate limiting på login (5 forsøg pr. minut pr. IP), på invitationskoder, på API'et og på upload, og alt input valideres med Zod-skemaer fra `packages/shared`.
- Al trafik uden for udvikling går over HTTPS; appen nægter at starte mod en `http://`-server i et build.

Git-historikken er scannet med [gitleaks](https://github.com/gitleaks/gitleaks) 8.30.1 den 19. nov. 2026: 43 commits, ingen hemmeligheder. Det eneste fund var test-hemmeligheden i `apps/server/test/helpers.ts`, som står i `.gitleaksignore`. Kør det selv fra roden:

```bash
gitleaks git --redact .
```

`.env`-filerne er gitignored. `.env.schema` beskriver, hvilke variabler der findes, og indeholder ingen værdier.

## Projektstruktur

```
rejsedagbog/
├── apps/
│   ├── native/      # Appen (React Native, Expo)
│   ├── server/      # API (Fastify, tRPC), upload-route, tests
│   └── web/         # Next.js (login)
├── packages/
│   ├── api/         # tRPC-routere og adgangstjek
│   ├── auth/        # Better Auth-konfiguration
│   ├── db/          # Prisma-skema og migrationer
│   ├── shared/      # Zod-skemaer, konstanter, vejrkoder og landedata (app og server)
│   └── ui/          # shadcn-komponenter til web
└── docs/            # Projektdokumentation, udviklingsplan, arkitektur og skærmbilleder
```

## Scripts

- `npm run dev`: start alle apps. `npm run dev:server`, `npm run dev:native` og `npm run dev:web` starter én ad gangen.
- `npm run test`: servertests (kræver databasen). `npm run check-types`: typecheck af alle pakker.
- `npm run db:migrate`, `npm run db:generate`, `npm run db:studio`: Prisma.
- `npm run env:generate`: generér `src/env.ts` efter ændringer i en `.env.schema`.
- `npm run auth:generate`: generér Better Auths Prisma-skema efter ændringer i auth-konfigurationen.
