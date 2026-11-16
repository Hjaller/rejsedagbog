import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { flagEmoji } from "@rejsedagbog/shared";

import { authorLabel, PostDetail, VideoBadge } from "@/components/post-views";
import { DayHeading, TripHeader } from "@/components/trip-header";
import { galleryColumns, useBreakpoint } from "@/lib/breakpoints";
import { dayHeading, formatDayShort, toIsoDate } from "@/lib/dates";
import { useLocalDb } from "@/lib/local-db/provider";
import { useSelectedPosts } from "@/lib/local-db/queries";
import { useRefreshSync } from "@/lib/sync/sync-scheduler";
import { isVideo, postImageSource, postImageUri, type LocalPost, type LocalTrip } from "@/lib/local-db/repo";
import { radius, space, typo, usePalette } from "@/lib/theme";

type Row = { type: "day"; key: string; title: string; subtitle?: string } | { type: "row"; key: string; posts: LocalPost[] };

const GAP = 3;

/** Den lokale dag, billedet er taget, som "YYYY-MM-DD". */
const dayKey = (post: LocalPost) => toIsoDate(new Date(post.takenAt));

type FilterOption = { key: string; label: string };

/**
 * Dage og personer, der kan filtreres på (Should: filter på dag/person). Kun
 * billeder tælles med, og dagene står i samme rækkefølge som i galleriet.
 */
function filterOptions(photos: LocalPost[], currentUserId: string) {
  const days = new Map<string, FilterOption>();
  const authors = new Map<string, FilterOption>();
  for (const post of photos) {
    const day = dayKey(post);
    if (!days.has(day)) days.set(day, { key: day, label: formatDayShort(new Date(post.takenAt)) });
    if (!authors.has(post.authorId)) {
      authors.set(post.authorId, { key: post.authorId, label: authorLabel(post, currentUserId) });
    }
  }
  return {
    days: [...days.values()].sort((a, b) => a.key.localeCompare(b.key)),
    // "Dig" først, derefter de andre i alfabetisk rækkefølge.
    authors: [...authors.values()].sort((a, b) =>
      a.key === currentUserId ? -1 : b.key === currentUserId ? 1 : a.label.localeCompare(b.label, "da"),
    ),
  };
}

/** Rejserne med billeder, i samme rækkefølge som i Rejser-fanen (nyeste først). */
function tripOptions(photos: LocalPost[], trips: LocalTrip[]): FilterOption[] {
  const withPhotos = new Set(photos.map((post) => post.tripId));
  return trips
    .filter((t) => withPhotos.has(t.id))
    .map((t) => ({ key: t.id, label: `${flagEmoji(t.countryCode)} ${t.name}` }));
}

/** Grupperer billeder pr. dag (wireframe 4) og deler dem op i rækker til et virtualiseret gitter. */
function buildRows(posts: LocalPost[], columns: number, trips: LocalTrip[]): Row[] {
  const tripsById = new Map(trips.map((t) => [t.id, t]));
  const byDay = new Map<string, LocalPost[]>();
  for (const post of posts) {
    const key = dayKey(post);
    const list = byDay.get(key) ?? [];
    list.push(post);
    byDay.set(key, list);
  }
  const rows: Row[] = [];
  // Ældste dag først i galleriet, ligesom en fotobog.
  for (const [key, list] of [...byDay.entries()].reverse()) {
    const ordered = [...list].reverse();
    const first = ordered[0]!;
    rows.push({ type: "day", key: `d-${key}`, ...dayHeading(new Date(first.takenAt), tripsById.get(first.tripId)) });
    for (let i = 0; i < ordered.length; i += columns) {
      rows.push({ type: "row", key: `r-${key}-${i}`, posts: ordered.slice(i, i + columns) });
    }
  }
  return rows;
}

export default function GalleryScreen() {
  const p = usePalette();
  const router = useRouter();
  const bp = useBreakpoint();
  const { user } = useLocalDb();
  const { trip, trips, showAll, scope, posts, pendingCount, isLoading } = useSelectedPosts();
  const [width, setWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [tripFilter, setTripFilter] = useState<string | null>(null);
  const refresh = useRefreshSync();

  const allPhotos = useMemo(() => (posts.data ?? []).filter((post) => !!postImageUri(post, "thumb")), [posts.data]);
  // Med "Alle rejser" kan der filtreres på rejse; dage og personer følger den valgte rejse.
  const tripChoices = useMemo(() => (showAll ? tripOptions(allPhotos, trips) : []), [showAll, allPhotos, trips]);
  const tripKey = tripChoices.some((t) => t.key === tripFilter) ? tripFilter : null;
  const photos = useMemo(
    () => (tripKey ? allPhotos.filter((post) => post.tripId === tripKey) : allPhotos),
    [allPhotos, tripKey],
  );
  const options = useMemo(() => filterOptions(photos, user.id), [photos, user.id]);
  // Et valg, der ikke længere findes (andet rejse, slettet billede), tæller som "alle".
  const day = options.days.some((d) => d.key === dayFilter) ? dayFilter : null;
  const author = options.authors.some((a) => a.key === authorFilter) ? authorFilter : null;
  const filtered = useMemo(
    () => photos.filter((post) => (!day || dayKey(post) === day) && (!author || post.authorId === author)),
    [photos, day, author],
  );

  const columns = galleryColumns(bp, width);
  const rows = useMemo(() => buildRows(filtered, columns, trips), [filtered, columns, trips]);
  const photoCount = filtered.length;
  const isFiltered = !!day || !!author || !!tripKey;
  const resetFilters = () => {
    setDayFilter(null);
    setAuthorFilter(null);
    setTripFilter(null);
  };
  const cell = width > 0 ? (width - space.lg * 2 - GAP * (columns - 1)) / columns : 0;

  const header = (
    <TripHeader
      eyebrow="GALLERI"
      trip={trip}
      allTrips={showAll ? trips : null}
      pendingCount={pendingCount}
      meta={`${photoCount} ${photoCount === 1 ? "billede" : "billeder"}`}
    />
  );

  const filters =
    tripChoices.length > 1 || options.authors.length > 1 || options.days.length > 1 ? (
      <View style={{ gap: space.sm, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: p.border }}>
        {tripChoices.length > 1 ? (
          <FilterRow
            label="Rejse"
            allLabel="Alle"
            options={tripChoices}
            value={tripKey}
            onChange={(key) => {
              setTripFilter(key);
              // Dagene hører til rejsen, så et dagvalg fra en anden rejse giver ikke mening.
              setDayFilter(null);
            }}
          />
        ) : null}
        {options.authors.length > 1 ? (
          <FilterRow
            label="Person"
            allLabel="Alle"
            options={options.authors}
            value={author}
            onChange={setAuthorFilter}
          />
        ) : null}
        {options.days.length > 1 ? (
          <FilterRow label="Dag" allLabel="Alle dage" options={options.days} value={day} onChange={setDayFilter} />
        ) : null}
      </View>
    ) : null;

  const open = (post: LocalPost) => {
    if (bp === "expanded") setSelectedId(post.id);
    else router.push(`/viewer/${post.id}`);
  };

  let body;
  if (isLoading || posts.isLoading) {
    body = <ActivityIndicator style={{ marginTop: space.xxl }} />;
  } else if (!scope) {
    body = (
      <EmptyState icon="images-outline" title="Ingen rejse valgt">
        <Button label="Ny rejse" icon="add" onPress={() => router.push("/trip/new")} />
      </EmptyState>
    );
  } else if (rows.length === 0 && isFiltered) {
    body = (
      <EmptyState icon="funnel-outline" title="Ingen billeder" message="Ingen billeder passer til filteret.">
        <Button label="Vis alle billeder" variant="secondary" onPress={resetFilters} />
      </EmptyState>
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState icon="images-outline" title="Ingen billeder endnu" message={showAll ? "Billederne fra dine rejsers indlæg samles her." : "Billederne fra rejsens indlæg samles her."}>
        <Button label="Nyt indlæg" icon="add" onPress={() => router.push("/post/add")} />
      </EmptyState>
    );
  } else {
    body = (
      <FlatList
        {...refresh}
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
        renderItem={({ item }) =>
          item.type === "day" ? (
            <View style={{ paddingBottom: space.sm }}>
              <DayHeading title={item.title} subtitle={item.subtitle} />
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: GAP, marginBottom: GAP }}>
              {item.posts.map((post) => (
                <GalleryCell key={post.id} post={post} size={cell} selected={post.id === selectedId} onPress={() => open(post)} />
              ))}
            </View>
          )
        }
      />
    );
  }

  const selected = (posts.data ?? []).find((x) => x.id === selectedId);

  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ flex: 1 }}>
        {header}
        {filters}
        <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 ? body : null}
        </View>
      </View>
      {bp === "expanded" ? (
        <View style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: p.border }}>
          {selected ? (
            <ScrollView contentContainerStyle={{ padding: space.xl }} contentInsetAdjustmentBehavior="automatic">
              <PostDetail
                post={selected}
                currentUserId={user.id}
                onImagePress={() => router.push(`/viewer/${selected.id}`)}
                onDeleted={() => setSelectedId(null)}
              />
            </ScrollView>
          ) : (
            <EmptyState icon="image-outline" title="Vælg et billede" message="Billedet vises her i stort format." />
          )}
        </View>
      ) : null}
    </View>
  );
}

function FilterRow({
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: FilterOption[];
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  const p = usePalette();
  const chips: { key: string | null; label: string }[] = [{ key: null, label: allLabel }, ...options];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm, alignItems: "center" }}
      accessibilityLabel={`Filtrér på ${label.toLowerCase()}`}
    >
      <Text style={[typo.eyebrow, { color: p.textMuted, width: 56 }]}>{label.toUpperCase()}</Text>
      {chips.map((chip) => {
        const selected = chip.key === value;
        return (
          <Pressable
            key={chip.key ?? "alle"}
            onPress={() => onChange(chip.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            hitSlop={{ top: 4, bottom: 4 }}
            style={({ pressed }) => ({
              minHeight: 36,
              paddingHorizontal: space.md,
              justifyContent: "center",
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: selected ? p.ink : p.borderStrong,
              backgroundColor: selected ? p.ink : pressed ? p.surfaceMuted : p.surface,
            })}
          >
            <Text style={{ color: selected ? p.onInk : p.text, fontSize: 14, fontWeight: selected ? "600" : "400" }}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function GalleryCell({
  post,
  size,
  selected,
  onPress,
}: {
  post: LocalPost;
  size: number;
  selected: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const pending = post.syncStatus !== "synkroniseret";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={`${isVideo(post) ? "Video: " : ""}${post.text || post.placeName || (isVideo(post) ? "uden tekst" : "Billede")}`}
      style={({ pressed }) => ({ width: size, height: size, opacity: pressed ? 0.8 : 1 })}
    >
      <Image
        source={postImageSource(post, "thumb")!}
        style={{ width: size, height: size, backgroundColor: p.placeholder }}
        contentFit="cover"
        recyclingKey={post.id}
      />
      <VideoBadge post={post} compact />
      {pending || selected ? (
        <View
          style={{
            position: "absolute",
            inset: 0,
            borderWidth: selected ? 3 : 1,
            borderStyle: selected ? "solid" : "dashed",
            borderColor: selected ? p.accent : "#FFFFFF",
            backgroundColor: pending ? "rgba(0,0,0,0.35)" : "transparent",
            alignItems: "center",
            justifyContent: "center",
            padding: 4,
          }}
        >
          {pending ? (
            <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600", textAlign: "center" }}>Venter på upload</Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
