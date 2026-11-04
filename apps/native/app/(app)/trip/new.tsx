import { COUNTRIES, countryName, flagEmoji, tripCreateInput } from "@rejsedagbog/shared";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import { formatDateInput, parseDateInput, toIsoDate } from "@/lib/dates";
import { useCreateTrip } from "@/lib/local-db/queries";
import { radius, space, usePalette } from "@/lib/theme";

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Opret rejse (navn, datoer, land). Gemmes lokalt og virker uden net, fordi
 * landelisten med danske navne ligger i appen.
 */
export default function NewTripScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const createTrip = useCreateTrip();

  const today = new Date();
  const inAWeek = new Date(today);
  inAWeek.setDate(today.getDate() + 7);

  const [name, setName] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [start, setStart] = useState(formatDateInput(toIsoDate(today)));
  const [end, setEnd] = useState(formatDateInput(toIsoDate(inAWeek)));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const matches = useMemo(() => {
    const q = normalize(countryQuery.trim());
    if (!q) return [];
    return COUNTRIES.filter((c) => normalize(c.name).includes(q) || c.code.toLowerCase() === q).slice(0, 6);
  }, [countryQuery]);

  const save = async () => {
    const startDate = parseDateInput(start);
    const endDate = parseDateInput(end);
    const fieldErrors: Record<string, string> = {};
    if (!startDate) fieldErrors.startDate = "Skriv datoen som dd.mm.åååå";
    if (!endDate) fieldErrors.endDate = "Skriv datoen som dd.mm.åååå";
    if (!countryCode) fieldErrors.countryCode = "Vælg et land";

    const input = {
      id: Crypto.randomUUID(),
      name,
      countryCode: countryCode ?? "",
      startDate: startDate ?? "",
      endDate: endDate ?? "",
    };
    const parsed = tripCreateInput.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        fieldErrors[key] ??= issue.message;
      }
    }
    setErrors(fieldErrors);
    if (!parsed.success || Object.keys(fieldErrors).length) return;

    try {
      await createTrip.mutateAsync(parsed.data);
      router.back();
    } catch (e) {
      console.error("[trip/new] kunne ikke gemme", e);
      setErrors({ form: "Rejsen kunne ikke gemmes. Prøv igen." });
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
        <TextField
          label="Navn"
          placeholder="Fx Rom 2026"
          value={name}
          onChangeText={setName}
          error={errors.name}
          autoFocus
          maxLength={80}
        />

        <View style={{ gap: space.sm }}>
          {countryCode ? (
            <View style={{ gap: space.xs }}>
              <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>Land</Text>
              <Pressable
                onPress={() => {
                  setCountryCode(null);
                  setCountryQuery("");
                }}
                accessibilityRole="button"
                accessibilityHint="Vælg et andet land"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderWidth: 1,
                  borderColor: p.borderStrong,
                  borderRadius: radius.md,
                  padding: space.md,
                  backgroundColor: p.surface,
                }}
              >
                <Text style={{ color: p.text, fontSize: 16 }}>
                  {flagEmoji(countryCode)} {countryName(countryCode)}
                </Text>
                <Text style={{ color: p.accent, fontSize: 15, fontWeight: "600" }}>Skift</Text>
              </Pressable>
            </View>
          ) : (
            <TextField
              label="Land"
              placeholder="Søg, fx Italien"
              value={countryQuery}
              onChangeText={setCountryQuery}
              error={errors.countryCode}
              autoCorrect={false}
            />
          )}
          {!countryCode && matches.length > 0 ? (
            <View style={{ borderWidth: 1, borderColor: p.border, borderRadius: radius.md, overflow: "hidden" }}>
              {matches.map((c, i) => (
                <Pressable
                  key={c.code}
                  onPress={() => {
                    setCountryCode(c.code);
                    setErrors((e) => ({ ...e, countryCode: "" }));
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    padding: space.md,
                    backgroundColor: pressed ? p.surfaceMuted : p.surface,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: p.border,
                  })}
                >
                  <Text style={{ color: p.text, fontSize: 16 }}>
                    {c.flag} {c.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", gap: space.md }}>
          <View style={{ flex: 1 }}>
            <TextField
              label="Fra"
              value={start}
              onChangeText={setStart}
              placeholder="dd.mm.åååå"
              keyboardType="numbers-and-punctuation"
              error={errors.startDate}
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label="Til"
              value={end}
              onChangeText={setEnd}
              placeholder="dd.mm.åååå"
              keyboardType="numbers-and-punctuation"
              error={errors.endDate}
            />
          </View>
        </View>

        {errors.form ? (
          <Text selectable accessibilityRole="alert" style={{ color: p.danger, fontSize: 15 }}>
            {errors.form}
          </Text>
        ) : null}
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
          label="Opret rejse"
          size="lg"
          onPress={save}
          loading={createTrip.isPending}
          style={{ maxWidth: 560, width: "100%", alignSelf: "center" }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
