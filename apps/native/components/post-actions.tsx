import { useRouter } from "expo-router";
import { Alert, View } from "react-native";

import { Button } from "@/components/button";
import { useDeletePost } from "@/lib/local-db/queries";
import type { LocalPost } from "@/lib/local-db/repo";
import { space } from "@/lib/theme";

/**
 * "Redigér tekst" og "Slet" på brugerens egne indlæg. Begge dele virker offline:
 * ændringen gemmes lokalt og sendes af upload-køen.
 */
export function PostActions({ post, onDeleted }: { post: LocalPost; onDeleted?: () => void }) {
  const router = useRouter();
  const deletePost = useDeletePost();

  const confirmDelete = () => {
    Alert.alert(
      "Slet indlægget?",
      "Indlægget og billedet slettes for alle på rejsen. Det kan ikke fortrydes.",
      [
        { text: "Annullér", style: "cancel" },
        {
          text: "Slet",
          style: "destructive",
          onPress: async () => {
            try {
              await deletePost.mutateAsync(post.id);
              onDeleted?.();
            } catch (e) {
              console.error("[post] kunne ikke slette", e);
              Alert.alert("Indlægget kunne ikke slettes", "Prøv igen.");
            }
          },
        },
      ],
    );
  };

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
      <Button
        label="Redigér tekst"
        icon="create-outline"
        variant="secondary"
        onPress={() => router.push({ pathname: "/post/edit/[id]", params: { id: post.id } })}
        style={{ flexGrow: 1, flexBasis: 160 }}
      />
      <Button
        label="Slet"
        icon="trash-outline"
        variant="danger"
        onPress={confirmDelete}
        loading={deletePost.isPending}
        style={{ flexGrow: 1, flexBasis: 160 }}
      />
    </View>
  );
}
