import { flagEmoji, weatherLabel } from "@rejsedagbog/shared";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { captureRef, releaseCapture } from "react-native-view-shot";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { formatDateLong } from "@/lib/dates";
import { usePost } from "@/lib/local-db/queries";
import { isVideo, postImageSource, type LocalPost } from "@/lib/local-db/repo";
import { fonts, space, typo, usePalette } from "@/lib/theme";

/**
 * Postkort (Could): billedet, teksten og stedet sat op som et postkort, der kan deles
 * med systemets delemenu (SMS, mail, Messenger …). Kortet gengives med react-native-view-shot,
 * så den delte JPEG har ingen EXIF og ingen GPS (sikkerhedsrisiko 3) – kun stednavnet,
 * som står på kortet. Kortet har altid lyse farver, også i mørk tilstand: det er et "papirkort".
 */
export default function PostcardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const post = usePost(id);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const [imageState, setImageState] = useState<"loading" | "ready" | "error">("loading");
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (post.isLoading) return <ActivityIndicator style={{ marginTop: space.xxl }} />;
  if (!post.data || !postImageSource(post.data)) {
    return (
      <EmptyState icon="image-outline" title="Postkortet kan ikke laves" message="Indlægget har intet billede." />
    );
  }

  const cardWidth = Math.min(width - space.lg * 2, 440);

  const share = async () => {
    setError(null);
    setSharing(true);
    let uri: string | null = null;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setError("Deling understøttes ikke på denne enhed.");
        return;
      }
      uri = await captureRef(cardRef, { format: "jpg", quality: 0.92, result: "tmpfile" });
      await Sharing.shareAsync(uri, { mimeType: "image/jpeg", UTI: "public.jpeg", dialogTitle: "Del postkort" });
    } catch (e) {
      console.warn("[postkort] kunne ikke deles", e);
      setError("Postkortet kunne ikke laves. Prøv igen.");
    } finally {
      if (uri) releaseCapture(uri);
      setSharing(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: p.background }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg, alignItems: "center" }}
    >
      <View
        style={{ transform: [{ rotate: "-1deg" }], boxShadow: "0 6px 18px rgba(60, 40, 20, 0.18)" }}
        accessible
        accessibilityLabel={`Postkort fra ${post.data.placeName ?? "rejsen"}${post.data.text ? `: ${post.data.text}` : ""}`}
      >
        {/* collapsable={false}: Android må ikke optimere visningen væk, så den kan fotograferes. */}
        <View ref={cardRef} collapsable={false}>
          <Postcard
            post={post.data}
            width={cardWidth}
            onImageLoad={() => setImageState("ready")}
            onImageError={() => setImageState("error")}
          />
        </View>
      </View>

      <View style={{ width: cardWidth, gap: space.sm }}>
        {imageState === "error" ? (
          <Text accessibilityRole="alert" style={{ color: p.danger, fontSize: 14 }}>
            Billedet kunne ikke hentes. Træk ned i tidslinjen for at hente det igen, og prøv så igen.
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={{ color: p.danger, fontSize: 14 }}>
            {error}
          </Text>
        ) : null}
        <Button
          label="Del postkort"
          icon="share-outline"
          size="lg"
          onPress={() => void share()}
          loading={sharing}
          disabled={imageState !== "ready"}
        />
        <Text style={{ color: p.textMuted, fontSize: 13, lineHeight: 18, textAlign: "center" }}>
          Postkortet sendes som et billede. Det indeholder ikke billedets GPS-position.
        </Text>
      </View>
    </ScrollView>
  );
}

const CARD = {
  paper: "#FBF7EE",
  ink: "#1C1B19",
  muted: "#6B675F",
  red: "#B9472A",
  line: "#E4DDCE",
} as const;

const MONTHS_SHORT = ["JAN", "FEB", "MAR", "APR", "MAJ", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEC"];

function Postcard({
  post,
  width,
  onImageLoad,
  onImageError,
}: {
  post: LocalPost;
  width: number;
  onImageLoad: () => void;
  onImageError: () => void;
}) {
  const pad = Math.round(width * 0.045);
  const date = new Date(post.takenAt);
  const place = post.placeName?.split(",")[0]?.trim();
  const fullPlace = post.placeName ?? "Et sted på rejsen";
  const stamp = Math.round(width * 0.2);
  return (
    <View style={{ width, backgroundColor: CARD.paper, padding: pad, gap: pad, borderRadius: 4 }}>
      <View>
        <Image
          source={postImageSource(post, "full")!}
          style={{ width: width - pad * 2, aspectRatio: 4 / 3, borderRadius: 2, backgroundColor: CARD.line }}
          contentFit="cover"
          onLoad={onImageLoad}
          onError={onImageError}
          accessibilityIgnoresInvertColors
        />
        {/* Poststemplet: sted, dato og vejr. */}
        <View
          style={{
            position: "absolute",
            top: pad * 0.6,
            right: pad * 0.6,
            width: stamp,
            height: stamp,
            borderRadius: stamp / 2,
            borderWidth: 2,
            borderColor: "rgba(255,255,255,0.92)",
            backgroundColor: "rgba(0,0,0,0.18)",
            alignItems: "center",
            justifyContent: "center",
            transform: [{ rotate: "-10deg" }],
          }}
        >
          {place ? (
            <Text
              numberOfLines={1}
              style={[typo.eyebrow, stampText, { fontSize: stamp * 0.1, letterSpacing: 1, maxWidth: stamp * 0.8 }]}
            >
              {place.toUpperCase()}
            </Text>
          ) : null}
          <Text style={[typo.eyebrow, stampText, { fontSize: stamp * 0.17, letterSpacing: 0.5 }]}>
            {`${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`}
          </Text>
          <Text style={[typo.eyebrow, stampText, { fontSize: stamp * 0.1, letterSpacing: 1 }]}>
            {String(date.getFullYear())}
          </Text>
        </View>
        {isVideo(post) ? (
          <Text style={[typo.eyebrow, stampText, { position: "absolute", left: pad * 0.6, bottom: pad * 0.5, fontSize: 10 }]}>
            ▶ VIDEO
          </Text>
        ) : null}
      </View>

      {/* Bagsiden: hilsen til venstre, frimærke og "adresse" til højre. */}
      <View style={{ flexDirection: "row", gap: pad }}>
        <View style={{ flex: 1.4, gap: 4 }}>
          <Text style={[typo.eyebrow, { color: CARD.red, fontSize: 10 }]}>HILSEN FRA</Text>
          <Text style={[typo.title, { color: CARD.ink, fontSize: 22, lineHeight: 27 }]} numberOfLines={2}>
            {fullPlace}
          </Text>
          {post.text ? (
            <Text style={[typo.note, { color: CARD.ink, fontSize: 15, lineHeight: 21, marginTop: 4 }]} numberOfLines={6}>
              {post.text}
            </Text>
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 6, borderLeftWidth: 1, borderLeftColor: CARD.line, paddingLeft: pad }}>
          {post.countryCode ? (
            <View style={{ alignItems: "flex-end" }}>
              <View
                style={{
                  width: 46,
                  height: 54,
                  borderWidth: 1.5,
                  borderStyle: "dashed",
                  borderColor: CARD.red,
                  borderRadius: 2,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontSize: 20 }}>{flagEmoji(post.countryCode)}</Text>
                <Text style={[typo.eyebrow, { color: CARD.red, fontSize: 10, letterSpacing: 1 }]}>
                  {post.countryCode.toUpperCase()}
                </Text>
              </View>
            </View>
          ) : null}
          <AddressLine text={formatDateLong(post.takenAt)} />
          {post.weather ? (
            <AddressLine text={`${Math.round(post.weather.tempC)}° · ${weatherLabel(post.weather.code)}`} />
          ) : null}
          <AddressLine text={`Fra ${post.authorName}`} />
        </View>
      </View>

      <Text style={[typo.eyebrow, { color: CARD.muted, fontSize: 9, textAlign: "center", fontFamily: fonts.mono }]}>
        REJSEPOST
      </Text>
    </View>
  );
}

const stampText = { color: "#FFFFFF", textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: 3 } as const;

function AddressLine({ text }: { text: string }) {
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: CARD.line, paddingBottom: 3 }}>
      <Text style={{ color: CARD.ink, fontSize: 12 }} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

