import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, ScrollView, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { placeLabel, PostDetail } from "@/components/post-views";
import { useLocalDb } from "@/lib/local-db/provider";
import { usePost } from "@/lib/local-db/queries";
import { space } from "@/lib/theme";

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useLocalDb();
  const post = usePost(id);

  if (post.isLoading) {
    return <ActivityIndicator style={{ marginTop: space.xxl }} />;
  }
  if (!post.data) {
    return (
      <View style={{ flex: 1 }}>
        <EmptyState icon="document-outline" title="Indlægget findes ikke" message="Det er måske blevet slettet." />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: placeLabel(post.data) }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.lg, maxWidth: 760, width: "100%", alignSelf: "center" }}
      >
        <PostDetail
          post={post.data}
          currentUserId={user.id}
          onImagePress={() => router.push(`/viewer/${post.data!.id}`)}
          onDeleted={() => router.back()}
        />
      </ScrollView>
    </>
  );
}
