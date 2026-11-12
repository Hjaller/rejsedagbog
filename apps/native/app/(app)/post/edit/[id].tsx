import { POST_TEXT_MAX, postText } from "@rejsedagbog/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { placeLabel } from "@/components/post-views";
import { TextField } from "@/components/text-field";
import { formatDateTimeLong } from "@/lib/dates";
import { useLocalDb } from "@/lib/local-db/provider";
import { usePost, useUpdatePostText } from "@/lib/local-db/queries";
import { space, usePalette } from "@/lib/theme";

/**
 * Ret teksten på et eget indlæg. Sted, vejr og billede kan ikke ændres, fordi de
 * er målt, da billedet blev taget. Gemmes lokalt og virker uden net.
 */
export default function EditPostScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useLocalDb();
  const post = usePost(id);
  const update = useUpdatePostText();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (post.isLoading) return <ActivityIndicator style={{ marginTop: space.xxl }} />;
  if (!post.data || post.data.authorId !== user.id) {
    return (
      <View style={{ flex: 1 }}>
        <EmptyState
          icon="document-outline"
          title="Indlægget kan ikke redigeres"
          message="Det er slettet, eller det er ikke dit eget."
        />
      </View>
    );
  }

  const original = post.data.text;
  const text = draft ?? original;

  const save = async () => {
    const parsed = postText.safeParse(text);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ugyldig tekst");
      return;
    }
    if (parsed.data === original) {
      router.back();
      return;
    }
    try {
      await update.mutateAsync({ postId: post.data!.id, text: parsed.data });
      router.back();
    } catch (e) {
      console.error("[post/edit] kunne ikke gemme", e);
      setError("Rettelsen kunne ikke gemmes. Prøv igen.");
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
        <Text style={{ color: p.textMuted, fontSize: 14 }}>
          {placeLabel(post.data)} · {formatDateTimeLong(post.data.takenAt)}
        </Text>
        <TextField
          label="Tekst"
          value={text}
          onChangeText={(v) => {
            setDraft(v);
            setError(null);
          }}
          multiline
          autoFocus
          counterMax={POST_TEXT_MAX}
          error={error}
          placeholder="Hvad skete der?"
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
          label="Gem rettelse"
          size="lg"
          onPress={save}
          loading={update.isPending}
          style={{ maxWidth: 560, width: "100%", alignSelf: "center" }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
