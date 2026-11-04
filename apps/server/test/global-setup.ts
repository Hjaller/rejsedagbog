import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { TEST_DATABASE_URL } from "./env";

/** Migrerer testdatabasen (oprettes hvis den mangler) og tømmer den før testkørslen. */
export default async function setup() {
  const dbPackage = fileURLToPath(new URL("../../../packages/db", import.meta.url));
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
    shell: process.platform === "win32",
  });

  const { createPrismaClient } = await import("@rejsedagbog/db");
  const db = createPrismaClient({ DATABASE_URL: TEST_DATABASE_URL });
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "media", "post", "trip_member", "trip", "session", "account", "verification", "user" CASCADE',
  );
  await db.$disconnect();
}
