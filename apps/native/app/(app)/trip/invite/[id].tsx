import type { InviteAccess } from "@rejsedagbog/shared";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Share, Text, View } from "react-native";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { apiErrorMessage } from "@/lib/api-errors";
import { useSetTripInviteCode, useTrips } from "@/lib/local-db/queries";
import { fonts, radius, space, typo, usePalette } from "@/lib/theme";
import { trpcClient } from "@/utils/trpc";

const OFFLINE = "Ingen forbindelse. Koder kræver internet.";

/** Teksterne for de to slags koder. */
const KINDS = {
  member: {
    eyebrow: "INVITATIONSKODE",
    title: "Invitér medrejsende",
    intro:
      "Til dem, du rejser med. Med koden kan de se rejsens indlæg og billeder og lægge deres egne op.",
    withCode:
      "Andre skriver koden under Rejser → Tilslut med kode. De kan se alle rejsens indlæg og billeder og lægge deres egne op. Kun du kan redigere og slette dine indlæg.",
    create: "Lav invitationskode",
    createIcon: "person-add-outline",
    share: "Del invitationskode",
    stop: "Stop invitationer",
    stopTitle: "Stop invitationer?",
    stopMessage: "Koden holder op med at virke. Dem, der allerede er med på rejsen, bliver.",
    message: (trip: string, code: string) => `Tilslut dig rejsen "${trip}" i Rejsepost med koden ${code}`,
  },
  viewer: {
    eyebrow: "KODE TIL DELING",
    title: "Del rejsen til visning",
    intro:
      "Til familie og venner derhjemme. Med koden kan de se rejsens indlæg og billeder, men ikke lægge noget op.",
    withCode:
      "Andre skriver koden under Rejser → Tilslut med kode. De kan se rejsens indlæg, billeder og hvem der er med, men de kan ikke lægge noget op.",
    create: "Lav kode til deling",
    createIcon: "eye-outline",
    share: "Del koden",
    stop: "Stop deling",
    stopTitle: "Stop deling?",
    stopMessage: "Koden holder op med at virke. Dem, der allerede kan se rejsen, kan stadig se den.",
    message: (trip: string, code: string) =>
      `Følg med på rejsen "${trip}" i Rejsepost. Skriv koden ${code} under Rejser → Tilslut med kode.`,
  },
} as const;

/**
 * Ejerens side til at give andre adgang til rejsen. Der er to koder: invitationskoden
 * til medrejsende (kan lægge op) og koden til deling (kan kun se). Begge kan stoppes
 * igen; dem, der allerede har adgang, beholder den.
 */
export default function InviteScreen() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const trips = useTrips();
  const setCode = useSetTripInviteCode();
  const [busy, setBusy] = useState<`${"create" | "revoke"}:${InviteAccess}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trip = trips.data?.find((t) => t.id === id);

  if (trips.isLoading) return <ActivityIndicator style={{ marginTop: space.xxl }} />;
  if (!trip || trip.role !== "owner") {
    return (
      <View style={{ flex: 1 }}>
        <EmptyState
          icon="people-outline"
          title="Kun rejsens ejer kan invitere og dele"
          message="Bed den, der har oprettet rejsen, om en kode."
        />
      </View>
    );
  }
  if (trip.syncStatus !== "synkroniseret") {
    return (
      <View style={{ flex: 1 }}>
        <EmptyState
          icon="cloud-offline-outline"
          title="Rejsen er ikke uploadet endnu"
          message="Den uploades automatisk, når du har internet. Derefter kan du invitere andre eller dele rejsen."
        />
      </View>
    );
  }

  const createCode = async (access: InviteAccess) => {
    setBusy(`create:${access}`);
    setError(null);
    try {
      const { code } = await trpcClient.invites.createCode.mutate({ tripId: trip.id, access });
      await setCode(trip.id, access, code);
    } catch (e) {
      setError(apiErrorMessage(e, OFFLINE));
    } finally {
      setBusy(null);
    }
  };

  const revoke = (access: InviteAccess) => {
    const kind = KINDS[access];
    Alert.alert(kind.stopTitle, kind.stopMessage, [
      { text: "Annullér", style: "cancel" },
      {
        text: "Stop",
        style: "destructive",
        onPress: async () => {
          setBusy(`revoke:${access}`);
          setError(null);
          try {
            await trpcClient.invites.revokeCode.mutate({ tripId: trip.id, access });
            await setCode(trip.id, access, null);
          } catch (e) {
            setError(apiErrorMessage(e, OFFLINE));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const section = (access: InviteAccess, code: string | null) => {
    const kind = KINDS[access];
    return (
      <View
        style={{
          gap: space.md,
          padding: space.lg,
          borderWidth: 1,
          borderColor: p.border,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          backgroundColor: p.surface,
        }}
      >
        <Text accessibilityRole="header" style={[typo.heading, { color: p.text }]}>
          {kind.title}
        </Text>
        {code ? (
          <>
            <View style={{ alignItems: "center", gap: space.xs, paddingVertical: space.sm }}>
              <Text style={[typo.eyebrow, { color: p.textMuted }]}>{kind.eyebrow}</Text>
              <Text
                selectable
                accessibilityLabel={`${kind.eyebrow.toLowerCase()} ${code.split("").join(" ")}`}
                style={{ color: p.text, fontFamily: fonts.label, fontSize: 38, letterSpacing: 6 }}
              >
                {code}
              </Text>
            </View>
            <Text style={{ color: p.textMuted, fontSize: 15, lineHeight: 21 }}>{kind.withCode}</Text>
            <Button
              label={kind.share}
              icon="share-outline"
              size="lg"
              onPress={() => Share.share({ message: kind.message(trip.name, code) })}
            />
            <Button
              label={kind.stop}
              variant="danger"
              onPress={() => revoke(access)}
              loading={busy === `revoke:${access}`}
              disabled={busy !== null}
            />
          </>
        ) : (
          <>
            <Text style={{ color: p.textMuted, fontSize: 15, lineHeight: 21 }}>{kind.intro}</Text>
            <Button
              label={kind.create}
              icon={kind.createIcon}
              variant={access === "member" ? "primary" : "secondary"}
              size="lg"
              onPress={() => createCode(access)}
              loading={busy === `create:${access}`}
              disabled={busy !== null}
            />
          </>
        )}
      </View>
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: p.background }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 560, width: "100%", alignSelf: "center" }}
    >
      <View style={{ gap: space.xs }}>
        <Text style={[typo.title, { color: p.text }]}>{trip.name}</Text>
        <Text style={{ color: p.textMuted, fontSize: 15 }}>
          {trip.memberCount === 1 ? "Kun dig indtil videre" : `${trip.memberCount} har adgang`}
        </Text>
      </View>

      {error ? (
        <Text selectable accessibilityRole="alert" style={{ color: p.danger, fontSize: 15 }}>
          {error}
        </Text>
      ) : null}

      {section("member", trip.inviteCode)}
      {section("viewer", trip.viewCode)}
    </ScrollView>
  );
}
