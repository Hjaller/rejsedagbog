# rejsedagbog

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Fastify, TRPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Fastify** - Fast, low-overhead web framework
- **tRPC** - End-to-end type-safe APIs
- **Node.js** - Runtime environment
- **Prisma** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Turborepo** - Optimized monorepo build system

## Kom i gang på en ny computer

Kravspecifikationen ligger i roden, og planen og den aktuelle status står i [docs/udviklingsplan.md](docs/udviklingsplan.md) (afsnit 10 viser, hvor langt projektet er).

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

En hemmelighed kan laves med `node -p "require('node:crypto').randomBytes(32).toString('hex')"`. Valgfrit: `S3_*` og `REST_COUNTRIES_API_KEY` (se `apps/server/.env.schema`). Ved deploy bag en reverse proxy skal `TRUST_PROXY` sættes til proxyens IP/CIDR, fx `172.16.0.0/12` i et Docker-netværk. Uden S3 gemmes billeder lokalt i `apps/server/.data/media` under udvikling.

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

Data følger ikke med git: den lokale database og uploadede billeder findes kun på den computer, de blev lavet på.

`npm run dev` starter alle apps på én gang. Web-appen kører på [http://localhost:3001](http://localhost:3001) og API'et på [http://localhost:3000](http://localhost:3000).

Efter ændringer i Prisma-skemaet: `npm run db:migrate` og `npm run db:generate`.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@rejsedagbog/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `npm run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Deployment

### Docker Compose

- Target: web + server
- Config: `docker-compose.yml` (app Dockerfiles live in `apps/*/Dockerfile`)
- Build images: npm run docker:build
- Start: npm run docker:up
- Logs: npm run docker:logs
- Stop: npm run docker:down

Environment variables are read from each app's `.env` file (baked into web builds for public variables) and overridden in `docker-compose.yml` for container networking.

For more details, see the guide on [Deploying with Docker Compose](https://www.better-t-stack.dev/docs/guides/docker).

## Project Structure

```
rejsedagbog/
├── apps/
│   ├── web/         # Frontend application (Next.js)
│   ├── native/      # Mobile application (React Native, Expo)
│   └── server/      # Backend API (Fastify, TRPC)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── shared/      # Zod-skemaer, konstanter, vejrkoder og landedata (bruges af app og server)
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `npm run dev`: Start all applications in development mode
- `npm run build`: Build all applications
- `npm run dev:web`: Start only the web application
- `npm run dev:server`: Start only the server
- `npm run check-types`: Check TypeScript types across all apps
- `npm run dev:native`: Start the React Native/Expo development server
- `npm run db:push`: Push schema changes to database
- `npm run db:generate`: Generate database client/types
- `npm run db:migrate`: Run database migrations
- `npm run db:studio`: Open database studio UI
- `npm run docker:build`: Build the Docker Compose images
- `npm run docker:up`: Build and start the Docker Compose stack
- `npm run docker:logs`: Tail logs from the Docker Compose stack
- `npm run docker:down`: Stop the Docker Compose stack

## Better Auth Schema Generation

After changing auth plugins or schema options, run `npm run auth:generate` from the project root. The script runs the Better Auth CLI through `varlock run` from the owning app directory, loading the auth instance from `src/services.ts`. Review the schema changes, then use your ORM's migration workflow to apply them.
