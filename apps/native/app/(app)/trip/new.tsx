import Ionicons from "@expo/vector-icons/Ionicons";
import { COUNTRIES, countryName, flagEmoji, TRIP_COUNTRIES_MAX, tripCreateInput } from "@rejsedagbog/shared";
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
 * Opret rejse (navn, datoer, lande). En rundrejse kan have flere lande, som vælges i
 * den rækkefølge, de besøges. Gemmes lokalt og virker uden net, fordi landelisten med
 * danske navne ligger i appen.
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
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const [start, setStart] = useState(formatDateInput(toIsoDate(today)));
  const [end, setEnd] = useState(formatDateInput(toIsoDate(inAWeek)));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const matches = useMemo(() => {
    const q = normalize(countryQuery.trim());
    if (!q) return [];
    return COUNTRIES.filter(
      (c) => !countryCodes.includes(c.code) && (normalize(c.name).includes(q) || c.code.toLowerCase() === q),
    ).slice(0, 6);
  }, [countryQuery, countryCodes]);
  const canAddCountry = countryCodes.length < TRIP_COUNTRIES_MAX;

  const save = async () => {
    const startDate = parseDateInput(start);
    const endDate = parseDateInput(end);
    const fieldErrors: Record<string, string> = {};
    if (!startDate) fieldErrors.startDate = "Skriv datoen som dd.mm.åååå";
    if (!endDate) fieldErrors.endDate = "Skriv datoen som dd.mm.åååå";
    if (countryCodes.length === 0) fieldErrors.countryCodes = "Vælg mindst ét land";

    const input = {
      id: Crypto.randomUUID(),
      name,
      countryCodes,
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
          {countryCodes.length > 0 ? (
            <View style={{ gap: space.xs }}>
              <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>
                {countryCodes.length === 1 ? "Land" : "Lande"}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {countryCodes.map((code) => (
                  <Pressable
                    key={code}
                    onPress={() => setCountryCodes((list) => list.filter((c) => c !== code))}
                    accessibilityRole="button"
                    accessibilityLabel={`Fjern ${countryName(code)}`}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.sm,
                      minHeight: 44,
                      paddingLeft: space.md,
                      paddingRight: space.sm,
                      borderWidth: 1,
                      borderColor: p.borderStrong,
                      borderRadius: radius.pill,
                      backgroundColor: pressed ? p.surfaceMuted : p.surface,
                    })}
                  >
                    <Text style={{ color: p.text, fontSize: 16 }}>
                      {flagEmoji(code)} {countryName(code)}
                    </Text>
                    <Ionicons name="close" size={18} color={p.textMuted} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {canAddCountry ? (
            <TextField
              label={countryCodes.length > 0 ? "Tilføj et land mere (rundrejse)" : "Land"}
              placeholder={countryCodes.length > 0 ? "Søg, fx Frankrig" : "Søg, fx Italien"}
              value={countryQuery}
              onChangeText={setCountryQuery}
              error={errors.countryCodes}
              autoCorrect={false}
            />
          ) : (
            <Text style={{ color: p.textMuted, fontSize: 14 }}>En rejse kan have højst {TRIP_COUNTRIES_MAX} lande.</Text>
          )}
          {canAddCountry && matches.length > 0 ? (
            <View style={{ borderWidth: 1, borderColor: p.border, borderRadius: radius.md, overflow: "hidden" }}>
              {matches.map((c, i) => (
                <Pressable
                  key={c.code}
                  onPress={() => {
                    setCountryCodes((list) => (list.includes(c.code) ? list : [...list, c.code]));
                    setCountryQuery("");
                    setErrors((e) => ({ ...e, countryCodes: "" }));
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
