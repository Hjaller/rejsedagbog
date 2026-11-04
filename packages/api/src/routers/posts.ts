import { Prisma } from "@rejsedagbog/db";
import { postCreateInput, postListInput, postRefInput, postUpdateInput } from "@rejsedagbog/shared";
import { TRPCError } from "@trpc/server";

import { postInclude, toPostDto } from "../dto";
import { router, tripMemberProcedure } from "../index";
import { enrich } from "../services/enrich";

const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Indlægget findes ikke" });

export const postsRouter = router({
  /**
   * Uden `since`: alle ikke-slettede indlæg. Med `since`: alt ændret siden da,
   * inkl. slettede (tombstones), så appen kan flette ind i SQLite.
   */
  list: tripMemberProcedure.input(postListInput).query(async ({ ctx, input }) => {
    const posts = await ctx.db.post.findMany({
      where: input.since
        ? { tripId: input.tripId, updatedAt: { gt: new Date(input.since) } }
        : { tripId: input.tripId, deletedAt: null },
      include: postInclude,
      orderBy: { takenAt: "desc" },
    });
    return Promise.all(posts.map((p) => toPostDto(p, ctx.storage)));
  }),

  get: tripMemberProcedure.input(postRefInput).query(async ({ ctx, input }) => {
    const post = await ctx.db.post.findFirst({
      where: { id: input.postId, tripId: input.tripId, deletedAt: null },
      include: postInclude,
    });
    if (!post) throw notFound();
    return toPostDto(post, ctx.storage);
  }),

  /**
   * Idempotent upsert på appens UUID. Mangler sted/vejr (oprettet offline),
   * beriges indlægget her ud fra koordinater og tidspunkt.
   */
  create: tripMemberProcedure.input(postCreateInput).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;

    const existing = await ctx.db.post.findUnique({ where: { id: input.id }, include: postInclude });
    if (existing) {
      if (existing.author.id !== userId || existing.tripId !== input.tripId) {
        throw new TRPCError({ code: "CONFLICT", message: "Indlægs-id'et er allerede i brug" });
      }
      return toPostDto(existing, ctx.storage);
    }

    if (input.mediaId) {
      // Billedet skal være uploadet af samme bruger til samme rejse og ikke hørt til et andet indlæg.
      const media = await ctx.db.media.findUnique({ where: { id: input.mediaId } });
      if (
        !media ||
        media.uploaderId !== userId ||
        media.tripId !== input.tripId ||
        (media.postId && media.postId !== input.id)
      ) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Billedet kan ikke bruges til dette indlæg" });
      }
    }

    const takenAt = new Date(input.takenAt);
    const hasCoords = input.lat != null && input.lon != null;
    const enrichment = hasCoords ? await enrich(input.lat!, input.lon!, takenAt, userId) : null;

    const trip = await ctx.db.trip.findUniqueOrThrow({
      where: { id: input.tripId },
      select: { countryCode: true },
    });

    const post = await ctx.db.post.create({
      data: {
        id: input.id,
        tripId: input.tripId,
        authorId: userId,
        text: input.text,
        takenAt,
        lat: input.lat ?? null,
        lon: input.lon ?? null,
        placeName: enrichment?.placeName ?? null,
        weather: (enrichment?.weather ?? undefined) as Prisma.InputJsonValue | undefined,
        countryCode: enrichment?.countryCode ?? trip.countryCode,
        media: input.mediaId ? { connect: { id: input.mediaId } } : undefined,
      },
      include: postInclude,
    });
    return toPostDto(post, ctx.storage);
  }),

  /** Kun forfatteren kan redigere. "Seneste ændring vinder" via updatedAt. */
  update: tripMemberProcedure.input(postUpdateInput).mutation(async ({ ctx, input }) => {
    const post = await ctx.db.post.findFirst({
      where: { id: input.postId, tripId: input.tripId, deletedAt: null },
      select: { authorId: true },
    });
    if (!post) throw notFound();
    if (post.authorId !== ctx.session.user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Du kan kun redigere dine egne indlæg" });
    }
    const updated = await ctx.db.post.update({
      where: { id: input.postId },
      data: { text: input.text },
      include: postInclude,
    });
    return toPostDto(updated, ctx.storage);
  }),

  /**
   * Soft delete + sletning af billederne i bucket'en. Kun forfatteren.
   * Rækken bliver stående som tombstone, men tekst, position, sted og vejr fjernes.
   */
  delete: tripMemberProcedure.input(postRefInput).mutation(async ({ ctx, input }) => {
    const post = await ctx.db.post.findFirst({
      where: { id: input.postId, tripId: input.tripId },
      select: { authorId: true, deletedAt: true, media: { select: { id: true, key: true, thumbKey: true } } },
    });
    if (!post) throw notFound();
    if (post.authorId !== ctx.session.user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Du kan kun slette dine egne indlæg" });
    }
    if (post.deletedAt) return { ok: true as const };

    await ctx.db.$transaction([
      ctx.db.media.deleteMany({ where: { postId: input.postId } }),
      ctx.db.post.update({
        where: { id: input.postId },
        data: {
          deletedAt: new Date(),
          text: "",
          lat: null,
          lon: null,
          placeName: null,
          weather: Prisma.DbNull,
          countryCode: null,
        },
      }),
    ]);
    if (ctx.storage && post.media.length) {
      const keys = post.media.flatMap((m) => (m.thumbKey ? [m.key, m.thumbKey] : [m.key]));
      await ctx.storage.delete(keys).catch((err) => {
        console.error("[posts.delete] kunne ikke slette objekter i bucket:", err);
      });
    }
    return { ok: true as const };
  }),
});
