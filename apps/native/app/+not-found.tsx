import { router } from "expo-router";
import { View } from "react-native";

import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { usePalette } from "@/lib/theme";

export default function NotFoundScreen() {
  const p = usePalette();
  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <EmptyState icon="compass-outline" title="Siden findes ikke" message="Linket peger på noget, der ikke er her.">
        <Button label="Gå til tidslinjen" onPress={() => router.replace("/")} />
      </EmptyState>
    </View>
  );
}
