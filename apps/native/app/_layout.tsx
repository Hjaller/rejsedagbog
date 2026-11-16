import { Fraunces_400Regular_Italic, Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { authClient } from "@/lib/auth-client";
import { NAV_THEME } from "@/lib/theme";
import { queryClient } from "@/utils/trpc";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const scheme = useColorScheme();
  const palette = scheme === "dark" ? NAV_THEME.dark : NAV_THEME.light;
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: palette.accent,
      background: palette.background,
      card: palette.surface,
      text: palette.text,
      border: palette.border,
      notification: palette.accent,
    },
  };

  // Sessionen caches i expo-secure-store af Better Auths Expo-klient, så auth-gaten virker offline.
  const { data: session, isPending } = authClient.useSession();
  const signedIn = !!session?.user;
  // Overskrifternes fonte (redesign D). Fejler de, bruges telefonens skrift i stedet.
  const [fontsLoaded, fontError] = useFonts({ Fraunces_600SemiBold, Fraunces_400Regular_Italic, IBMPlexMono_500Medium });
  const ready = !isPending && (fontsLoaded || !!fontError);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={navTheme}>
        <StatusBar style="auto" />
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.background }}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Protected guard={signedIn}>
              <Stack.Screen name="(app)" />
            </Stack.Protected>
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
          </Stack>
        </GestureHandlerRootView>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
