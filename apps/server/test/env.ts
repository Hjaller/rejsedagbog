/** Separat database, så testene aldrig rører udviklingsdata. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/rejsedagbog_test";
