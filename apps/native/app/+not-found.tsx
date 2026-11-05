import { Redirect, router } from "expo-router";
import { View } from "react-native";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { authClient } from "@/lib/auth-client";
import { usePalette } from "@/lib/theme";

export default function NotFoundScreen() {
  const p = usePalette();
  const { data: session, isPending } = authClient.useSession();

  // Uden login er alle appens ruter (også "/") skjult af auth-gaten og ender her.
  if (!isPending && !session?.user) return <Redirect href="/sign-in" />;

  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <EmptyState icon="compass-outline" title="Siden findes ikke" message="Linket peger på noget, der ikke er her.">
        <Button label="Gå til tidslinjen" onPress={() => router.replace("/")} />
      </EmptyState>
    </View>
  );
}
