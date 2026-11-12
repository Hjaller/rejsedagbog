FROM node:24-slim AS builder
WORKDIR /app

COPY . .
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local --mount=type=cache,target=/root/.npm npm install

ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local cd apps/server && npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app

EXPOSE 3000

WORKDIR /app/apps/server
# Migrationer køres ved hver opstart (idempotent), så en ny version aldrig starter mod et
# gammelt skema. Fejler de, starter serveren ikke, og den gamle container bliver kørende.
CMD ["sh", "-c", "cd /app/packages/db && npx --no-install prisma migrate deploy && cd /app/apps/server && exec node dist/index.mjs"]
