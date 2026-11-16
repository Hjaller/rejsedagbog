import { Stack, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";

import { authClient } from "@/lib/auth-client";
import { LocalDbProvider, useLocalDb, type CurrentUser } from "@/lib/local-db/provider";
import { useRefreshCountryFactsOnStart } from "@/lib/local-db/queries";
import { recoverPendingPhoto, stashRecoveredPhoto } from "@/lib/media";
import { useSyncScheduler } from "@/lib/sync/sync-scheduler";
import { fonts, usePalette } from "@/lib/theme";
import { trpcClient } from "@/utils/trpc";

export const unstable_settings = { anchor: "(tabs)" };

function Bootstrap() {
  const { db, user } = useLocalDb();
  // Upload-kø og hentning af rejser/indlæg.
  useSyncScheduler(db, user.id);
  // Landefakta (valuta, sprog) fra REST Countries via serveren, cachet i SQLite.
  useRefreshCountryFactsOnStart(() => trpcClient.enrich.countries.query());
  useRecoverPendingPhoto();
  return null;
}

/**
 * Lukkede Android appen, mens telefonens kamera var åbent, kommer billedet tilbage her,
 * når appen starter igen, og gemmes som et nyt indlæg, så det ikke går tabt.
 */
function useRecoverPendingPhoto() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    void recoverPendingPhoto().then((photo) => {
      if (cancelled || !photo) return;
      stashRecoveredPhoto(photo);
      router.push({ pathname: "/post/new", params: { recovered: "1" } });
    });
    return () => {
      cancelled = true;
    };
    // Kun ved opstart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
          headerStyle: { backgroundColor: p.background },
          headerTintColor: p.text,
          headerTitleStyle: { fontFamily: fonts.display, fontSize: 19 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: p.background },
          headerBackButtonDisplayMode: "minimal",
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* "+": vælg mellem kameraet og albummet. */}
        <Stack.Screen
          name="post/add"
          options={{
            presentation: "formSheet",
            headerShown: false,
            title: "Nyt indlæg",
            sheetAllowedDetents: "fitToContents",
            sheetGrabberVisible: true,
            sheetCornerRadius: 24,
            contentStyle: { backgroundColor: p.surface },
          }}
        />
        {/* Åbner telefonens kamera eller album med det samme, så skærmen har ingen header (redesign D1/D2). */}
        <Stack.Screen
          name="post/new"
          options={{ presentation: "fullScreenModal", headerShown: false, animation: "fade", title: "Nyt indlæg" }}
        />
        <Stack.Screen
          name="trip/switch"
          options={{
            presentation: "formSheet",
            headerShown: false,
            title: "Vis rejse",
            sheetAllowedDetents: "fitToContents",
            sheetGrabberVisible: true,
            sheetCornerRadius: 24,
            contentStyle: { backgroundColor: p.surface },
          }}
        />
        {/* Fuld skærm, så det at flytte kortet ikke lukker et ark. */}
        <Stack.Screen
          name="post/place"
          options={{ presentation: "fullScreenModal", headerShown: false, title: "Sæt sted" }}
        />
        <Stack.Screen name="post/[id]" options={{ title: "" }} />
        <Stack.Screen name="profile" options={{ title: "Profil" }} />
        <Stack.Screen name="post/edit/[id]" options={{ presentation: "modal", title: "Redigér indlæg" }} />
        <Stack.Screen name="trip/new" options={{ presentation: "modal", title: "Ny rejse" }} />
        <Stack.Screen name="trip/join" options={{ presentation: "modal", title: "Tilslut rejse" }} />
        <Stack.Screen name="trip/invite/[id]" options={{ presentation: "modal", title: "Invitér" }} />
        <Stack.Screen name="trip/members/[id]" options={{ presentation: "modal", title: "Gruppen" }} />
        <Stack.Screen
          name="viewer/[postId]"
          options={{ presentation: "fullScreenModal", headerShown: false, animation: "fade" }}
        />
      </Stack>
    </LocalDbProvider>
  );
}
