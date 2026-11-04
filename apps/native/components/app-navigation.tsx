import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { TabTrigger, type TabTriggerSlotProps } from "expo-router/ui";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, space, usePalette } from "@/lib/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** De fem faner fra wireframes. `name` matcher filerne i app/(app)/(tabs). */
export const NAV_ITEMS = [
  { name: "index", href: "/", label: "Tidslinje", icon: "list", iconOutline: "list-outline" },
  { name: "gallery", href: "/gallery", label: "Galleri", icon: "images", iconOutline: "images-outline" },
  { name: "map", href: "/map", label: "Kort", icon: "map", iconOutline: "map-outline" },
  { name: "trips", href: "/trips", label: "Rejser", icon: "airplane", iconOutline: "airplane-outline" },
  {
    name: "profile",
    href: "/profile",
    label: "Profil",
    icon: "person-circle",
    iconOutline: "person-circle-outline",
  },
] as const satisfies readonly {
  name: string;
  href: string;
  label: string;
  icon: IconName;
  iconOutline: IconName;
}[];

type NavButtonProps = Omit<TabTriggerSlotProps, "ref"> & {
  item: (typeof NAV_ITEMS)[number];
  orientation: "bottom" | "side";
};

function NavButton({ item, orientation, isFocused, ...props }: NavButtonProps) {
  const p = usePalette();
  const color = isFocused ? p.text : p.textMuted;
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!isFocused }}
      accessibilityLabel={item.label}
      style={({ pressed }) => ({
        flex: orientation === "bottom" ? 1 : undefined,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        paddingVertical: space.sm,
        minHeight: 52,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={isFocused ? item.icon : item.iconOutline} size={24} color={color} />
      <Text style={{ color, fontSize: 11, fontWeight: isFocused ? "700" : "500" }}>{item.label}</Text>
      {isFocused ? (
        <View
          style={
            orientation === "bottom"
              ? { position: "absolute", top: 0, width: 28, height: 3, borderRadius: 2, backgroundColor: p.accent }
              : { position: "absolute", left: 0, top: 14, bottom: 14, width: 3, borderRadius: 2, backgroundColor: p.accent }
          }
        />
      ) : null}
    </Pressable>
  );
}

function useNewPost() {
  const router = useRouter();
  return () => router.push("/post/new");
}

/**
 * Flydende "+"-knap på mobil. Lægges over skærmindholdet (ikke inde i bundbaren),
 * fordi Android ikke sender tryk til views uden for forælderens grænser.
 */
export function NewPostFab() {
  const p = usePalette();
  const newPost = useNewPost();
  return (
    <Pressable
      onPress={newPost}
      accessibilityRole="button"
      accessibilityLabel="Nyt indlæg"
      style={({ pressed }) => ({
        position: "absolute",
        right: space.lg,
        bottom: space.lg,
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: p.ink,
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Ionicons name="add" size={32} color={p.onInk} />
    </Pressable>
  );
}

/** Mobil (< 600 dp): navigationsbar i bunden. */
export function BottomBar() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        borderTopWidth: 1,
        borderTopColor: p.border,
        backgroundColor: p.surface,
        paddingBottom: insets.bottom,
      }}
    >
      {NAV_ITEMS.map((item) => (
        <TabTrigger key={item.name} name={item.name} asChild>
          <NavButton item={item} orientation="bottom" />
        </TabTrigger>
      ))}
    </View>
  );
}

/** Tablet/stor skærm (≥ 600 dp): sidebar i venstre side med "+" øverst. */
export function SideBar() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const newPost = useNewPost();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        width: 88 + insets.left,
        paddingLeft: insets.left,
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.lg,
        borderRightWidth: 1,
        borderRightColor: p.border,
        backgroundColor: p.surface,
        alignItems: "stretch",
        gap: space.sm,
      }}
    >
      <Pressable
        onPress={newPost}
        accessibilityRole="button"
        accessibilityLabel="Nyt indlæg"
        style={({ pressed }) => ({
          alignSelf: "center",
          width: 56,
          height: 56,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          backgroundColor: p.ink,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: space.md,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Ionicons name="add" size={30} color={p.onInk} />
      </Pressable>
      {NAV_ITEMS.map((item) => (
        <TabTrigger key={item.name} name={item.name} asChild>
          <NavButton item={item} orientation="side" />
        </TabTrigger>
      ))}
    </View>
  );
}
