import Ionicons from "@expo/vector-icons/Ionicons";
import { countryName, flagEmoji, formatCountryFacts, formatWeather, weatherLabel } from "@rejsedagbog/shared";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { Button } from "@/components/button";
import { PostActions } from "@/components/post-actions";
import { SyncIcon, syncLabel } from "@/components/sync-status";
import { formatDateTimeLong, formatRelative } from "@/lib/dates";
import { isVideo, postImageSource, postVideoUri, type LocalPost } from "@/lib/local-db/repo";
import { formatDuration } from "@/lib/media";
import { useCountryFacts } from "@/lib/local-db/queries";
import { radius, space, typo, usePalette, type Palette } from "@/lib/theme";

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

const MONTHS_SHORT = ["JAN", "FEB", "MAR", "APR", "MAJ", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEC"];

/** Stemplets tre linjer: sted, dato og vejr, som på et poststempel. */
function postmarkLines(post: LocalPost): string[] {
  const date = new Date(post.takenAt);
  const place = post.placeName?.split(",")[0]?.trim().toUpperCase();
  const lines = [
    place && place.length <= 12 ? place : (place?.slice(0, 11) ?? "").concat(place ? "…" : ""),
    `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`,
    post.weather
      ? `${Math.round(post.weather.tempC)}° ${weatherLabel(post.weather.code).split(" ")[0]!.toUpperCase()}`
      : "",
  ];
  return lines;
}

/** Hvert indlæg får sin egen lille drejning, så tidslinjen ikke ser stanset ud. */
function stampTilt(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `${(Math.abs(h) % 21) - 12}deg`;
}

/** Poststempel over billedet med sted, dato og vejr (redesign D). */
function Postmark({ post, size = 84 }: { post: LocalPost; size?: number }) {
  const [place, date, weather] = postmarkLines(post);
  const shadow = { textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: 3 } as const;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: "rgba(255,255,255,0.9)",
        backgroundColor: "rgba(0,0,0,0.16)",
        alignItems: "center",
        justifyContent: "center",
        transform: [{ rotate: stampTilt(post.id) }],
      }}
    >
      {place ? (
        <Text style={[typo.eyebrow, shadow, { color: "#FFFFFF", fontSize: 9, letterSpacing: 1 }]}>{place}</Text>
      ) : null}
      <Text style={[typo.eyebrow, shadow, { color: "#FFFFFF", fontSize: 15, letterSpacing: 0.5 }]}>{date}</Text>
      {weather ? (
        <Text style={[typo.eyebrow, shadow, { color: "#FFFFFF", fontSize: 9, letterSpacing: 1 }]}>{weather}</Text>
      ) : null}
    </View>
  );
}

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

/**
 * Afspil-mærke over en videos plakatramme. `compact` er til små miniaturer (galleri,
 * lister): kun et lille ikon i hjørnet. Ellers en afspil-knap i midten og længden nederst.
 */
export function VideoBadge({ post, compact = false }: { post: LocalPost; compact?: boolean }) {
  if (!isVideo(post)) return null;
  if (compact) {
    return (
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 4,
          bottom: 4,
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
          paddingHorizontal: 4,
          paddingVertical: 1,
          borderRadius: 4,
          backgroundColor: "rgba(0,0,0,0.55)",
        }}
      >
        <Ionicons name="play" size={10} color="#FFFFFF" />
        {post.durationMs != null ? (
          <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
            {formatDuration(post.durationMs)}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: "rgba(0,0,0,0.45)",
          borderWidth: 2,
          borderColor: "rgba(255,255,255,0.9)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="play" size={26} color="#FFFFFF" style={{ marginLeft: 3 }} />
      </View>
      {post.durationMs != null ? (
        <Text
          style={{
            position: "absolute",
            left: 10,
            bottom: 8,
            color: "#FFFFFF",
            fontSize: 13,
            fontWeight: "700",
            fontVariant: ["tabular-nums"],
            textShadowColor: "rgba(0,0,0,0.6)",
            textShadowRadius: 3,
          }}
        >
          {formatDuration(post.durationMs)}
        </Text>
      ) : null}
    </View>
  );
}

/** Kort status til kort og lister: kun når indlægget ikke er sendt endnu. */
function PendingNote({ post, size = 13 }: { post: LocalPost; size?: number }) {
  const p = usePalette();
  if (!isPending(post) && !post.pendingOp) return null;
  const label = isPending(post) ? syncLabel(post.syncStatus) : "rettelse venter";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <SyncIcon status={isPending(post) ? post.syncStatus : "lokal"} size={size + 2} />
      <Text style={{ color: p.accentText, fontSize: size, fontWeight: "600" }}>
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Postkort i tidslinjen (mobil)
// ---------------------------------------------------------------------------

export function PostCard({
  post,
  currentUserId,
  tripLabel,
  onPress,
}: {
  post: LocalPost;
  currentUserId: string;
  /** Rejsens navn, når indlæg fra flere rejser vises sammen. */
  tripLabel?: string | null;
  onPress: () => void;
}) {
  const p = usePalette();
  const pending = isPending(post);
  const hasImage = !!postImageSource(post, "full");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${isVideo(post) ? "Video. " : ""}${placeLabel(post)}. ${post.text}`}
      style={({ pressed }) => ({
        backgroundColor: p.surface,
        borderRadius: radius.sm,
        borderCurve: "continuous",
        borderWidth: pending ? 1.5 : 1,
        borderColor: pending ? p.borderStrong : p.border,
        // Stiplet ramme = ikke sendt endnu, som et postkort, der ikke er afsendt.
        borderStyle: pending ? "dashed" : "solid",
        padding: 10,
        paddingBottom: 14,
        gap: space.md,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View>
        <PostImage post={post} size="full" p={p} style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 2 }} />
        <VideoBadge post={post} />
        {hasImage ? <Postmark post={post} /> : null}
      </View>
      <View style={{ paddingHorizontal: space.xs, gap: 6 }}>
        {tripLabel ? (
          <Text style={[typo.eyebrow, { color: p.textMuted }]} numberOfLines={1}>
            {tripLabel.toUpperCase()}
          </Text>
        ) : null}
        <Text style={[typo.heading, { color: p.text, fontSize: 21 }]} numberOfLines={1}>
          {placeLabel(post)}
        </Text>
        {post.text ? (
          <Text style={[typo.note, { color: p.text }]} numberOfLines={4}>
            {post.text}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 2 }}>
          <Text style={{ flex: 1, color: p.textMuted, fontSize: 13 }} numberOfLines={1}>
            {authorLabel(post, currentUserId)} · {formatRelative(post.takenAt)}
          </Text>
          <PendingNote post={post} />
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Række i master-listen (tablet/stor skærm) og på kortet
// ---------------------------------------------------------------------------

export function PostListItem({
  post,
  currentUserId,
  selected,
  tripLabel,
  onPress,
}: {
  post: LocalPost;
  currentUserId: string;
  selected: boolean;
  /** Rejsens navn, når indlæg fra flere rejser vises sammen. */
  tripLabel?: string | null;
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
        backgroundColor: selected || pressed ? p.surfaceMuted : p.surface,
        borderBottomWidth: 1,
        borderBottomColor: p.border,
      })}
    >
      {selected ? (
        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: p.accent }} />
      ) : null}
      <View>
        <PostImage
          post={post}
          size="thumb"
          p={p}
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.sm,
            borderWidth: pending ? 1.5 : 0,
            borderStyle: "dashed",
            borderColor: p.accent,
          }}
        />
        <VideoBadge post={post} compact />
      </View>
      <View style={{ flex: 1, gap: 2, justifyContent: "center" }}>
        <Text style={[typo.heading, { color: p.text, fontSize: 17, lineHeight: 22 }]} numberOfLines={1}>
          {placeLabel(post)}
        </Text>
        {post.text ? (
          <Text style={{ color: p.text, fontSize: 14 }} numberOfLines={1}>
            {post.text}
          </Text>
        ) : null}
        {pending ? (
          <PendingNote post={post} size={12} />
        ) : (
          <Text numberOfLines={1} style={{ color: p.textMuted, fontSize: 12 }}>
            {`${tripLabel ? `${tripLabel} · ` : ""}${authorLabel(post, currentUserId)} · ${formatRelative(post.takenAt)}`}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Detaljevisning (egen skærm på mobil, højre side på stor skærm)
// ---------------------------------------------------------------------------

function InfoRow({ label, value }: { label: string; value: string }) {
  const p = usePalette();
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: p.border, paddingBottom: 6, gap: 1 }}>
      <Text style={[typo.eyebrow, { color: p.textMuted, fontSize: 10 }]}>{label}</Text>
      <Text selectable style={{ color: p.text, fontSize: 14 }}>
        {value}
      </Text>
    </View>
  );
}

/** Upload-status under postkortet, sagt i almindelige ord. */
function SyncStatusRow({ post }: { post: LocalPost }) {
  const p = usePalette();
  const pending = isPending(post);
  const message =
    post.syncStatus === "lokal"
      ? "Gemt på telefonen. Sendes til gruppen, når du har net."
      : post.syncStatus === "uploader"
        ? "Sendes til gruppen nu …"
        : post.syncStatus === "fejl"
          ? "Afsendelsen fejlede. Appen prøver igen af sig selv."
          : post.pendingOp === "update"
            ? "Rettelsen venter på at blive sendt."
            : "Sendt til gruppen.";
  const waiting = pending || !!post.pendingOp;
  return (
    <View
      accessibilityRole="text"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm + 2,
        borderWidth: 1,
        borderStyle: waiting ? "dashed" : "solid",
        borderColor: waiting ? p.accent : p.border,
        borderRadius: radius.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm + 2,
      }}
    >
      <SyncIcon status={waiting && !pending ? "lokal" : post.syncStatus} size={20} />
      <Text style={{ flex: 1, color: p.text, fontSize: 14 }}>{message}</Text>
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
  const router = useRouter();
  const facts = useCountryFacts(post.countryCode);
  const pending = isPending(post);
  const video = isVideo(post);

  const coords = post.lat != null && post.lon != null ? `${post.lat.toFixed(4)}, ${post.lon.toFixed(4)}` : null;
  const place = post.placeName ?? (coords ? `${coords}${pending ? " (navn hentes senere)" : ""}` : "Ingen position");
  const weather = post.weather
    ? formatWeather(post.weather, { withWind: true })
    : pending && coords
      ? "Hentes ved upload"
      : "Ikke tilgængeligt";
  const country = post.countryCode ? formatCountryFacts(post.countryCode, facts.data) : "Ukendt";

  return (
    <View style={{ gap: space.lg }}>
      {/* Billedet som et aftryk med hvid kant */}
      <Pressable
        onPress={onImagePress}
        disabled={!onImagePress || !(postImageSource(post) || postVideoUri(post))}
        accessibilityRole="imagebutton"
        accessibilityLabel={video ? "Afspil videoen" : "Vis billedet i fuld skærm"}
        style={{
          backgroundColor: p.surface,
          padding: 10,
          paddingBottom: 30,
          boxShadow: "0 2px 10px rgba(60, 40, 20, 0.14)",
          marginHorizontal: space.xs,
        }}
      >
        <View>
          <PostImage post={post} size="full" p={p} style={{ width: "100%", aspectRatio: 4 / 3 }} />
          <VideoBadge post={post} />
        </View>
      </Pressable>

      <View style={{ gap: space.xs }}>
        <Text selectable accessibilityRole="header" style={[typo.title, { color: p.text, fontSize: 30, lineHeight: 36 }]}>
          {placeLabel(post)}
        </Text>
        <Text style={{ color: p.textMuted, fontSize: 14 }}>
          {authorLabel(post, currentUserId)} · {formatDateTimeLong(post.takenAt)}
        </Text>
      </View>

      {/* Postkortets bagside: teksten til venstre, stempel og "adresse" til højre */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: space.lg,
          backgroundColor: p.paper,
          borderWidth: 1,
          borderColor: p.border,
          borderRadius: radius.sm,
          padding: space.lg,
        }}
      >
        <View style={{ flexGrow: 1.25, flexBasis: 150 }}>
          {post.text ? (
            <Text selectable style={[typo.note, { color: p.text }]}>
              {post.text}
            </Text>
          ) : (
            <Text style={[typo.note, { color: p.textMuted }]}>Ingen tekst</Text>
          )}
        </View>
        <View style={{ flexGrow: 1, flexBasis: 130, gap: space.sm, borderLeftWidth: 1, borderLeftColor: p.border, paddingLeft: space.lg }}>
          {post.countryCode ? (
            <View style={{ alignItems: "flex-end" }}>
              <View
                style={{
                  width: 48,
                  height: 56,
                  borderWidth: 1.5,
                  borderStyle: "dashed",
                  borderColor: p.accent,
                  borderRadius: 2,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 20 }}>{flagEmoji(post.countryCode)}</Text>
                <Text style={[typo.eyebrow, { color: p.accentText, letterSpacing: 1 }]}>{post.countryCode.toUpperCase()}</Text>
              </View>
            </View>
          ) : null}
          <InfoRow label="STED" value={place} />
          <InfoRow label="VEJR" value={weather} />
          <InfoRow label="LAND" value={country || countryName(post.countryCode)} />
        </View>
      </View>

      <SyncStatusRow post={post} />

      {/* Postkort (Could): kræver et billede eller en plakatramme, og deling virker ikke på web. */}
      {process.env.EXPO_OS !== "web" && postImageSource(post) ? (
        <Button
          label="Del som postkort"
          icon="share-outline"
          variant="secondary"
          onPress={() => router.push({ pathname: "/post/postcard/[id]", params: { id: post.id } })}
          accessibilityHint="Laver et postkort med billedet, teksten og stedet, som du kan sende til andre"
        />
      ) : null}

      {post.authorId === currentUserId ? <PostActions post={post} onDeleted={onDeleted} /> : null}
    </View>
  );
}
