import { INVITE_CODE_LENGTH, inviteCode } from "@rejsedagbog/shared";
import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import { apiErrorMessage } from "@/lib/api-errors";
import { useLocalDb } from "@/lib/local-db/provider";
import { useActiveTrip, useInvalidateLocal } from "@/lib/local-db/queries";
import { upsertTripFromServer } from "@/lib/local-db/sync-repo";
import { requestSync } from "@/lib/sync/sync-scheduler";
import { fonts, space, usePalette } from "@/lib/theme";
import { trpcClient } from "@/utils/trpc";

/**
 * Tilslut en grupperejse med en kode fra ejeren. Kræver net, fordi serveren skal
 * give adgang; bagefter hentes rejsens indlæg og billeder i baggrunden.
 */
export default function JoinTripScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { db } = useLocalDb();
  const { setActiveTrip } = useActiveTrip();
  const invalidate = useInvalidateLocal();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = async () => {
    const parsed = inviteCode.safeParse(code);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ugyldig kode");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const trip = await trpcClient.invites.join.mutate({ code: parsed.data });
      await upsertTripFromServer(db, trip);
      await setActiveTrip(trip.id);
      await invalidate();
      // Hent rejsens indlæg med det samme i stedet for at vente på næste planlagte hentning.
      void requestSync({ pull: true, ignoreBackoff: true });
      router.dismissTo("/");
    } catch (e) {
      setError(apiErrorMessage(e, "Ingen forbindelse. Du skal have internet for at tilslutte dig en rejse."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={process.env.EXPO_OS === "ios" ? 64 : 0}
      style={{ flex: 1, backgroundColor: p.background }}
    >
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 560, width: "100%", alignSelf: "center" }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: p.textMuted, fontSize: 15, lineHeight: 21 }}>
          Skriv koden, du har fået af den, der har oprettet rejsen. Så kan du se alle rejsens indlæg og billeder og
          lægge dine egne op.
        </Text>
        <TextField
          label="Invitationskode"
          placeholder="Fx K7M2QX"
          value={code}
          onChangeText={(v) => {
            setCode(v.toUpperCase());
            setError(null);
          }}
          error={error}
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          maxLength={INVITE_CODE_LENGTH + 2}
          returnKeyType="go"
          onSubmitEditing={join}
          style={{ fontSize: 24, letterSpacing: 6, fontFamily: fonts.mono }}
        />
      </ScrollView>

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: p.border,
          backgroundColor: p.surface,
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: Math.max(insets.bottom, space.md),
        }}
      >
        <Button
          label="Tilslut rejse"
          size="lg"
          onPress={join}
          loading={busy}
          style={{ maxWidth: 560, width: "100%", alignSelf: "center" }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
