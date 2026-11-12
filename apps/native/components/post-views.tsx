import Ionicons from "@expo/vector-icons/Ionicons";
import { countryName, formatCountryFacts, formatWeather, weatherLabel } from "@rejsedagbog/shared";
import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";

import { PostActions } from "@/components/post-actions";
import { SyncIcon, syncLabel } from "@/components/sync-status";
import { formatDateTimeLong, formatRelative } from "@/lib/dates";
import { postImageSource, type LocalPost } from "@/lib/local-db/repo";
import { useCountryFacts } from "@/lib/local-db/queries";
import { radius, space, usePalette, type Palette } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Fælles hjælpere
// ---------------------------------------------------------------------------

export function authorLabel(post: LocalPost, currentUserId: string): string {
  return post.authorId === currentUserId ? "Dig" : post.authorName;
}

/** Stednavn, eller hvorfor det mangler (offline-oprettede indlæg beriges ved upload). */
export function placeLabel(post: LocalPost): string {
  if (post.placeName) return post.placeName;
  if (post.lat == null) return "Ukendt sted";
  return post.syncStatus === "synkroniseret" ? "Ukendt sted" : "Sted hentes senere";
}

export function weatherShort(post: LocalPost): string {
  if (post.weather) return `${Math.round(post.weather.tempC)}° · ${weatherLabel(post.weather.code)}`;
  if (post.lat == null) return "";
  return post.syncStatus === "synkroniseret" ? "" : "Vejr hentes senere";
}

const isPending = (post: LocalPost) => post.syncStatus !== "synkroniseret";

function PostImage({
  post,
  size,
  style,
  p,
}: {
  post: LocalPost;
  size: "full" | "thumb";
  style: object;
  p: Palette;
}) {
  const source = postImageSource(post, size);
  if (!source) {
    return (
      <View style={[{ backgroundColor: p.placeholder, alignItems: "center", justifyContent: "center" }, style]}>
        <Ionicons name="image-outline" size={28} color={p.textMuted} />
      </View>
    );
  }
  return (
    <Image
      source={source}
      style={[{ backgroundColor: p.placeholder }, style]}
      contentFit="cover"
      transition={150}
      accessibilityIgnoresInvertColors
    />
  );
}

// ---------------------------------------------------------------------------
// Kort i tidslinjen (mobil)
// ---------------------------------------------------------------------------

export function PostCard({
  post,
  currentUserId,
  onPress,
}: {
  post: LocalPost;
  currentUserId: string;
  onPress: () => void;
}) {
  const p = usePalette();
  const pending = isPending(post);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${placeLabel(post)}. ${post.text}`}
      style={({ pressed }) => ({
        backgroundColor: p.surface,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: pending ? p.borderStrong : p.border,
        // Stiplet ramme = ikke uploadet endnu (wireframe)
        borderStyle: pending ? "dashed" : "solid",
        overflow: "hidden",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <PostImage post={post} size="full" p={p} style={{ width: "100%", aspectRatio: 4 / 3 }} />
      <View style={{ padding: space.md, gap: space.xs }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
          <Text style={{ color: p.textMuted, fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
            {placeLabel(post)}
          </Text>
          <Text style={{ color: p.textMuted, fontSize: 13 }}>{weatherShort(post)}</Text>
        </View>
        {post.text ? (
          <Text style={{ color: p.text, fontSize: 17 }} numberOfLines={3}>
            {post.text}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <SyncIcon status={post.syncStatus} />
          <Text
            style={{ color: pending ? p.text : p.textMuted, fontSize: 13, fontWeight: pending ? "600" : "400" }}
          >
            {authorLabel(post, currentUserId)} · {formatRelative(post.takenAt)} · {syncLabel(post.syncStatus)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Række i master-listen (tablet/stor skærm)
// ---------------------------------------------------------------------------

export function PostListItem({
  post,
  currentUserId,
  selected,
  onPress,
}: {
  post: LocalPost;
  currentUserId: string;
  selected: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const pending = isPending(post);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: space.md,
        padding: space.md,
        backgroundColor: selected ? p.surfaceMuted : pressed ? p.surfaceMuted : p.surface,
        borderBottomWidth: 1,
        borderBottomColor: p.border,
      })}
    >
      {selected ? (
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: p.ink }} />
      ) : null}
      <PostImage
        post={post}
        size="thumb"
        p={p}
        style={{
          width: 64,
          height: 64,
          borderRadius: radius.sm,
          borderWidth: pending ? 1 : 0,
          borderStyle: "dashed",
          borderColor: p.borderStrong,
        }}
      />
      <View style={{ flex: 1, gap: 2, justifyContent: "center" }}>
        <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }} numberOfLines={1}>
          {placeLabel(post)}
        </Text>
        {post.text ? (
          <Text style={{ color: p.text, fontSize: 14 }} numberOfLines={1}>
            {post.text}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          {pending ? <SyncIcon status={post.syncStatus} size={12} /> : null}
          <Text style={{ color: pending ? p.text : p.textMuted, fontSize: 12, fontWeight: pending ? "600" : "400" }}>
            {pending
              ? syncLabel(post.syncStatus)
              : `${authorLabel(post, currentUserId)} · ${formatRelative(post.takenAt)}`}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Detaljevisning (egen skærm på mobil, højre side på stor skærm)
// ---------------------------------------------------------------------------

function InfoTile({ label, value }: { label: string; value: string }) {
  const p = usePalette();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 180,
        borderWidth: 1,
        borderColor: p.border,
        borderRadius: radius.md,
        borderCurve: "continuous",
        padding: space.md,
        gap: 2,
      }}
    >
      <Text style={{ color: p.textMuted, fontSize: 11, letterSpacing: 0.8 }}>{label}</Text>
      <Text selectable style={{ color: p.text, fontSize: 15 }}>
        {value}
      </Text>
    </View>
  );
}

export function PostDetail({
  post,
  currentUserId,
  onImagePress,
  onDeleted,
}: {
  post: LocalPost;
  currentUserId: string;
  /** Åbner billedet i fuld skærm. */
  onImagePress?: () => void;
  /** Kaldes, når brugeren har slettet indlægget (fx for at gå tilbage). */
  onDeleted?: () => void;
}) {
  const p = usePalette();
  const facts = useCountryFacts(post.countryCode);
  const pending = isPending(post);

  const coords = post.lat != null && post.lon != null ? `${post.lat.toFixed(4)}, ${post.lon.toFixed(4)}` : null;
  const place = post.placeName ?? (coords ? `${coords}${pending ? " (navn hentes senere)" : ""}` : "Ingen position");
  const weather = post.weather
    ? formatWeather(post.weather, { withWind: true })
    : pending && coords
      ? "Hentes ved upload"
      : "Ikke tilgængeligt";
  const country = post.countryCode
    ? formatCountryFacts(post.countryCode, facts.data)
    : "Ukendt";

  return (
    <View style={{ gap: space.lg }}>
      <Pressable
        onPress={onImagePress}
        disabled={!onImagePress || !postImageSource(post)}
        accessibilityRole="imagebutton"
        accessibilityLabel="Vis billedet i fuld skærm"
      >
        <PostImage
          post={post}
          size="full"
          p={p}
          style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: radius.lg, borderCurve: "continuous" }}
        />
      </Pressable>
      <View style={{ gap: space.xs }}>
        <Text selectable style={{ color: p.text, fontSize: 24, fontWeight: "700" }}>
          {placeLabel(post)}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexWrap: "wrap" }}>
          <Text style={{ color: p.textMuted, fontSize: 14 }}>
            {authorLabel(post, currentUserId)} · {formatDateTimeLong(post.takenAt)}
          </Text>
          <SyncIcon status={post.syncStatus} />
          <Text style={{ color: p.textMuted, fontSize: 14 }}>{syncLabel(post.syncStatus)}</Text>
          {post.pendingOp === "update" ? (
            <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>· rettelse venter på upload</Text>
          ) : null}
        </View>
      </View>
      {post.text ? (
        <Text selectable style={{ color: p.text, fontSize: 17, lineHeight: 24 }}>
          {post.text}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
        <InfoTile label="STED (GPS)" value={place} />
        <InfoTile label="VEJR (OPEN-METEO)" value={weather} />
        <InfoTile
          label="LAND (REST COUNTRIES)"
          value={country || countryName(post.countryCode)}
        />
      </View>
      {post.authorId === currentUserId ? <PostActions post={post} onDeleted={onDeleted} /> : null}
    </View>
  );
}
