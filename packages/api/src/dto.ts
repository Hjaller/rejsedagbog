import type { Weather } from "@rejsedagbog/shared";

import type { MediaStorage } from "./storage";

/**
 * Det API'et returnerer. Datoer er ISO-strenge, fordi tRPC kører uden transformer,
 * og JSON alligevel ville gøre dem til strenge på klienten.
 */
export type TripDto = {
  id: string;
  name: string;
  countryCode: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  role: "owner" | "member";
  memberCount: number;
  /** Kun med for ejeren. */
  inviteCode: string | null;
  updatedAt: string;
};

/** Et medlem af en rejse. Uden e-mail: de andre i gruppen skal kun se navnet. */
export type TripMemberDto = {
  id: string;
  name: string;
  role: "owner" | "member";
  joinedAt: string;
};

export type MediaDto = {
  id: string;
  kind: string;
  /** Signeret, tidsbegrænset URL. null hvis lageret ikke er konfigureret. */
  url: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
};

export type PostDto = {
  id: string;
  tripId: string;
  author: { id: string; name: string };
  text: string;
  takenAt: string;
  lat: number | null;
  lon: number | null;
  placeName: string | null;
  weather: Weather | null;
  countryCode: string | null;
  media: MediaDto[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** Felterne, toTripDto skal bruge. */
export const tripSelect = {
  id: true,
  name: true,
  countryCode: true,
  startDate: true,
  endDate: true,
  inviteCode: true,
  ownerId: true,
  updatedAt: true,
  _count: { select: { members: true } },
} as const;

const toDateOnly = (d: Date) => d.toISOString().slice(0, 10);

export function toTripDto(
  trip: {
    id: string;
    name: string;
    countryCode: string;
    startDate: Date;
    endDate: Date;
    inviteCode: string | null;
    updatedAt: Date;
    _count: { members: number };
  },
  role: "owner" | "member",
): TripDto {
  return {
    id: trip.id,
    name: trip.name,
    countryCode: trip.countryCode,
    startDate: toDateOnly(trip.startDate),
    endDate: toDateOnly(trip.endDate),
    role,
    memberCount: trip._count.members,
    inviteCode: role === "owner" ? trip.inviteCode : null,
    updatedAt: trip.updatedAt.toISOString(),
  };
}

export const postInclude = {
  author: { select: { id: true, name: true } },
  media: {
    select: { id: true, kind: true, key: true, thumbKey: true, width: true, height: true },
    orderBy: { createdAt: "asc" },
  },
} as const;

type PostRow = {
  id: string;
  tripId: string;
  author: { id: string; name: string };
  text: string;
  takenAt: Date;
  lat: number | null;
  lon: number | null;
  placeName: string | null;
  weather: unknown;
  countryCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  media: {
    id: string;
    kind: string;
    key: string;
    thumbKey: string | null;
    width: number | null;
    height: number | null;
  }[];
};

function isWeather(v: unknown): v is Weather {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Weather).tempC === "number" &&
    typeof (v as Weather).code === "number"
  );
}

export async function toPostDto(post: PostRow, storage: MediaStorage | null): Promise<PostDto> {
  // Slettede indlæg sendes kun som "tombstones", uden indhold, position og billeder.
  const deleted = !!post.deletedAt;
  const media = deleted
    ? []
    : await Promise.all(
        post.media.map(async (m) => ({
          id: m.id,
          kind: m.kind,
          url: storage ? await storage.signedGetUrl(m.key) : null,
          thumbUrl: storage && m.thumbKey ? await storage.signedGetUrl(m.thumbKey) : null,
          width: m.width,
          height: m.height,
        })),
      );
  return {
    id: post.id,
    tripId: post.tripId,
    author: post.author,
    text: deleted ? "" : post.text,
    takenAt: post.takenAt.toISOString(),
    lat: deleted ? null : post.lat,
    lon: deleted ? null : post.lon,
    placeName: deleted ? null : post.placeName,
    weather: !deleted && isWeather(post.weather) ? post.weather : null,
    countryCode: deleted ? null : post.countryCode,
    media,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    deletedAt: post.deletedAt?.toISOString() ?? null,
  };
}
