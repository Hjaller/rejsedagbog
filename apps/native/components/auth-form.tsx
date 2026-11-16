import { signInInput, signUpInput } from "@rejsedagbog/shared";
import { Link } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";

import { Button } from "@/components/button";
import { TextField } from "@/components/text-field";
import { authClient } from "@/lib/auth-client";
import { space, typo, usePalette } from "@/lib/theme";
import { queryClient } from "@/utils/trpc";

type Mode = "sign-in" | "sign-up";

/** Dansk login/opret konto. Valideringen deles med serveren via @rejsedagbog/shared. */
export function AuthForm({ mode }: { mode: Mode }) {
  const p = usePalette();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    const parsed =
      mode === "sign-up"
        ? signUpInput.safeParse({ name, email, password })
        : signInInput.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Tjek felterne");
      return;
    }
    setSubmitting(true);
    const callbacks = {
      onError: (ctx: { error: { status: number; message?: string } }) => {
        setError(authErrorMessage(mode, ctx.error));
      },
      onSuccess: () => {
        queryClient.clear();
      },
    };
    try {
      if (mode === "sign-up") {
        await authClient.signUp.email({ name: name.trim(), email: email.trim(), password }, callbacks);
      } else {
        await authClient.signIn.email({ email: email.trim(), password }, callbacks);
      }
    } catch {
      setError("Kunne ikke forbinde til serveren. Tjek din internetforbindelse.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView
        style={{ backgroundColor: p.background }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: "100%", maxWidth: 420, alignSelf: "center", gap: space.lg }}>
          <View style={{ gap: space.sm, marginBottom: space.md }}>
            {/* Poststemplet er appens mærke (redesign D). */}
            <View
              accessible={false}
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                borderWidth: 2,
                borderColor: p.accent,
                alignItems: "center",
                justifyContent: "center",
                transform: [{ rotate: "-12deg" }],
                marginBottom: space.md,
              }}
            >
              <Text style={[typo.eyebrow, { color: p.accentText, fontSize: 10 }]}>REJSE</Text>
              <Text style={[typo.heading, { color: p.accentText, lineHeight: 22 }]}>post</Text>
              <Text style={[typo.eyebrow, { color: p.accentText, fontSize: 9 }]}>✶ ✶ ✶</Text>
            </View>
            <Text style={[typo.eyebrow, { color: p.textMuted }]}>REJSEPOST</Text>
            <Text accessibilityRole="header" style={[typo.hero, { color: p.text, fontSize: 36, lineHeight: 42 }]}>
              {mode === "sign-up" ? "Opret konto" : "Log ind"}
            </Text>
            <Text style={{ color: p.textMuted, fontSize: 16, lineHeight: 22 }}>
              {mode === "sign-up"
                ? "Saml rejsens billeder, sted og vejr ét sted – også uden internet."
                : "Velkommen tilbage. Dine indlæg venter på dig."}
            </Text>
          </View>

          {mode === "sign-up" ? (
            <TextField
              label="Navn"
              value={name}
              onChangeText={setName}
              autoComplete="name"
              textContentType="name"
              placeholder="Fx Sara"
            />
          ) : null}
          <TextField
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="navn@eksempel.dk"
          />
          <TextField
            label="Adgangskode"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            textContentType={mode === "sign-up" ? "newPassword" : "password"}
            placeholder="Mindst 8 tegn"
            onSubmitEditing={submit}
          />

          {error ? (
            <Text selectable accessibilityRole="alert" style={{ color: p.danger, fontSize: 15 }}>
              {error}
            </Text>
          ) : null}

          <Button
            label={mode === "sign-up" ? "Opret konto" : "Log ind"}
            onPress={submit}
            loading={submitting}
            size="lg"
          />

          <Link href={mode === "sign-up" ? "/sign-in" : "/sign-up"} replace asChild>
            <Button
              variant="ghost"
              label={mode === "sign-up" ? "Har du allerede en konto? Log ind" : "Ny bruger? Opret en konto"}
            />
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function authErrorMessage(mode: Mode, error: { status: number; message?: string }): string {
  if (error.status === 429) return "For mange forsøg. Vent et øjeblik, og prøv igen.";
  if (mode === "sign-in" && (error.status === 401 || error.status === 400)) {
    return "Forkert e-mail eller adgangskode.";
  }
  if (mode === "sign-up" && error.status === 422) return "Der findes allerede en konto med den e-mail.";
  return "Noget gik galt. Prøv igen.";
}
