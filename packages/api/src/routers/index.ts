import { publicProcedure, router } from "../index";
import { enrichRouter } from "./enrich";
import { postsRouter } from "./posts";
import { tripsRouter } from "./trips";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => "OK" as const),
  trips: tripsRouter,
  posts: postsRouter,
  enrich: enrichRouter,
});
export type AppRouter = typeof appRouter;

export type { MediaDto, PostDto, TripDto } from "../dto";
