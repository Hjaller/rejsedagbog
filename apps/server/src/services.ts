import { createAuth } from "@rejsedagbog/auth";
import { createPrismaClient } from "@rejsedagbog/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db);
