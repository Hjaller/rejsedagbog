import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Share, Text, View } from "react-native";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { apiErrorMessage } from "@/lib/api-errors";
import { useSetTripInviteCode, useTrips } from "@/lib/local-db/queries";
import { radius, space, usePalette } from "@/lib/theme";
import { trpcClient } from "@/utils/trpc";

const OFFLINE = "Ingen forbindelse. Invitationer kræver internet.";

/**
 * Ejerens side til at invitere andre til en grupperejse: lav en kode, del den,
 * eller stop invitationerne igen (eksisterende medlemmer bliver).
 */
export default function InviteScreen() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const trips = useTrips();
  const setInviteCode = useSetTripInviteCode();
  const [busy, setBusy] = useState<"create" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trip = trips.data?.find((t) => t.id === id);

  if (trips.isLoading) return <ActivityIndicator style={{ marginTop: space.xxl }} />;
  if (!trip || trip.role !== "owner") {
    return (
      <View style={{ flex: 1 }}>
        <EmptyState
          icon="people-outline"
          title="Kun rejsens ejer kan invitere"
          message="Bed den, der har oprettet rejsen, om en invitationskode."
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
          message="Den uploades automatisk, når du har internet. Derefter kan du invitere andre."
        />
      </View>
    );
  }

  const createCode = async () => {
    setBusy("create");
    setError(null);
    try {
      const { code } = await trpcClient.invites.createCode.mutate({ tripId: trip.id });
      await setInviteCode(trip.id, code);
    } catch (e) {
      setError(apiErrorMessage(e, OFFLINE));
    } finally {
      setBusy(null);
    }
  };

  const revoke = () => {
    Alert.alert(
      "Stop invitationer?",
      "Koden holder op med at virke. Dem, der allerede er med på rejsen, bliver.",
      [
        { text: "Annullér", style: "cancel" },
        {
          text: "Stop",
          style: "destructive",
          onPress: async () => {
            setBusy("revoke");
            setError(null);
            try {
              await trpcClient.invites.revokeCode.mutate({ tripId: trip.id });
              await setInviteCode(trip.id, null);
            } catch (e) {
              setError(apiErrorMessage(e, OFFLINE));
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const share = (code: string) =>
    Share.share({ message: `Tilslut dig rejsen "${trip.name}" i Rejsepost med koden ${code}` });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: p.background }}
      contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 560, width: "100%", alignSelf: "center" }}
    >
      <View style={{ gap: space.xs }}>
        <Text style={{ color: p.text, fontSize: 22, fontWeight: "700" }}>{trip.name}</Text>
        <Text style={{ color: p.textMuted, fontSize: 15 }}>
          {trip.memberCount === 1 ? "Kun dig indtil videre" : `${trip.memberCount} i gruppen`}
        </Text>
      </View>

      {trip.inviteCode ? (
        <>
          <View
            style={{
              alignItems: "center",
              gap: space.sm,
              paddingVertical: space.xl,
              borderWidth: 1,
              borderColor: p.border,
              borderRadius: radius.lg,
              borderCurve: "continuous",
              backgroundColor: p.surface,
            }}
          >
            <Text style={{ color: p.textMuted, fontSize: 12, letterSpacing: 1.2 }}>INVITATIONSKODE</Text>
            <Text
              selectable
              accessibilityLabel={`Invitationskode ${trip.inviteCode.split("").join(" ")}`}
              style={{ color: p.text, fontSize: 40, fontWeight: "700", letterSpacing: 8, fontVariant: ["tabular-nums"] }}
            >
              {trip.inviteCode}
            </Text>
          </View>
          <Text style={{ color: p.textMuted, fontSize: 15, lineHeight: 21 }}>
            Andre skriver koden under Rejser → Tilslut. De kan se alle rejsens indlæg og billeder og lægge deres egne
            op. Kun du kan redigere og slette dine indlæg.
          </Text>
          <Button label="Del kode" icon="share-outline" size="lg" onPress={() => share(trip.inviteCode!)} />
          <Button
            label="Stop invitationer"
            variant="danger"
            onPress={revoke}
            loading={busy === "revoke"}
            disabled={busy !== null}
          />
        </>
      ) : (
        <>
          <Text style={{ color: p.textMuted, fontSize: 15, lineHeight: 21 }}>
            Lav en kode på 6 tegn, som du kan sende til dem, du rejser med. Med koden kan de se rejsens indlæg og
            billeder og lægge deres egne op.
          </Text>
          <Button
            label="Lav invitationskode"
            icon="person-add-outline"
            size="lg"
            onPress={createCode}
            loading={busy === "create"}
            disabled={busy !== null}
          />
        </>
      )}

      {error ? (
        <Text selectable accessibilityRole="alert" style={{ color: p.danger, fontSize: 15 }}>
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}
