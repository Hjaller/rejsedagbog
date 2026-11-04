import { Stack } from "expo-router";
import { useMemo } from "react";

import { authClient } from "@/lib/auth-client";
import { LocalDbProvider, useLocalDb, type CurrentUser } from "@/lib/local-db/provider";
import { useRefreshCountryFactsOnStart } from "@/lib/local-db/queries";
import { useSyncScheduler } from "@/lib/sync/sync-scheduler";
import { usePalette } from "@/lib/theme";
import { trpcClient } from "@/utils/trpc";

export const unstable_settings = { initialRouteName: "(tabs)" };

function Bootstrap() {
  const { db, user } = useLocalDb();
  // Upload-kø og hentning af rejser/indlæg.
  useSyncScheduler(db, user.id);
  // Landefakta (valuta, sprog) fra REST Countries via serveren, cachet i SQLite.
  useRefreshCountryFactsOnStart(() => trpcClient.enrich.countries.query());
  return null;
}

export default function AppLayout() {
  const p = usePalette();
  const { data: session } = authClient.useSession();
  const sessionUser = session?.user;
  const user = useMemo<CurrentUser | null>(
    () => (sessionUser ? { id: sessionUser.id, name: sessionUser.name, email: sessionUser.email } : null),
    [sessionUser?.id, sessionUser?.name, sessionUser?.email],
  );

  // Auth-gaten i roden sørger for, at vi kun er her med en session.
  if (!user) return null;

  return (
    <LocalDbProvider user={user}>
      <Bootstrap />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: p.surface },
          headerTintColor: p.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: p.background },
          headerBackButtonDisplayMode: "minimal",
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="post/new" options={{ presentation: "modal", title: "Nyt indlæg" }} />
        <Stack.Screen name="post/[id]" options={{ title: "" }} />
        <Stack.Screen name="trip/new" options={{ presentation: "modal", title: "Ny rejse" }} />
        <Stack.Screen
          name="viewer/[postId]"
          options={{ presentation: "fullScreenModal", headerShown: false, animation: "fade" }}
        />
      </Stack>
    </LocalDbProvider>
  );
}
