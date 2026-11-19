import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { TabTrigger, type TabTriggerSlotProps } from "expo-router/ui";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProfileButton } from "@/components/profile-button";
import { radius, space, usePalette } from "@/lib/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/**
 * De fire faner (redesign D). Profil ligger som avatar i headeren, og "+" sidder
 * fast midt i bundbaren. `name` matcher filerne i app/(app)/(tabs).
 */
export const NAV_ITEMS = [
  { name: "index", href: "/", label: "Tidslinje", icon: "list", iconOutline: "list-outline" },
  { name: "gallery", href: "/gallery", label: "Galleri", icon: "images", iconOutline: "images-outline" },
  { name: "map", href: "/map", label: "Kort", icon: "map", iconOutline: "map-outline" },
  { name: "trips", href: "/trips", label: "Rejser", icon: "briefcase", iconOutline: "briefcase-outline" },
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
        gap: 3,
        paddingVertical: space.sm,
        minHeight: 52,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={isFocused ? item.icon : item.iconOutline} size={24} color={color} />
      {/* Én linje: med stor skrift skaleres etiketten ned, til den passer i fanen, i stedet for at knække. */}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        style={{ alignSelf: "stretch", textAlign: "center", color, fontSize: 11, fontWeight: isFocused ? "700" : "500" }}
      >
        {item.label}
      </Text>
      {isFocused && orientation === "side" ? (
        <View
          style={{ position: "absolute", left: 0, top: 14, bottom: 14, width: 3, borderRadius: 2, backgroundColor: p.accent }}
        />
      ) : null}
    </Pressable>
  );
}

/** "+": vælg mellem telefonens kamera og albummet. */
function NewPostButton({ size, raised }: { size: number; raised?: boolean }) {
  const p = usePalette();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push("/post/add")}
      accessibilityRole="button"
      accessibilityLabel="Nyt indlæg"
      accessibilityHint="Tag et billede, eller vælg fra albummet"
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: p.accent,
        alignItems: "center",
        justifyContent: "center",
        // Løftet over bundbaren med en ring i papirfarven.
        ...(raised ? { marginTop: -26, borderWidth: 4, borderColor: p.background } : null),
        boxShadow: "0 4px 12px rgba(120, 40, 20, 0.28)",
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Ionicons name="add" size={size * 0.5} color={p.onAccent} />
    </Pressable>
  );
}

/** Mobil (< 600 dp): to faner, "+", to faner. */
export function BottomBar() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [first, second, third, fourth] = NAV_ITEMS;
  const tab = (item: (typeof NAV_ITEMS)[number]) => (
    <TabTrigger key={item.name} name={item.name} asChild>
      <NavButton item={item} orientation="bottom" />
    </TabTrigger>
  );
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        borderTopWidth: 1,
        borderTopColor: p.border,
        backgroundColor: p.paper,
        paddingTop: 4,
        paddingBottom: insets.bottom,
      }}
    >
      {tab(first)}
      {tab(second)}
      <View style={{ flex: 1, alignItems: "center" }}>
        <NewPostButton size={60} raised />
      </View>
      {tab(third)}
      {tab(fourth)}
    </View>
  );
}

/** Tablet/stor skærm (≥ 600 dp): sidebar med "+" øverst og profilen nederst. */
export function SideBar() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
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
        backgroundColor: p.paper,
        alignItems: "stretch",
        gap: space.sm,
      }}
    >
      <View style={{ alignItems: "center", marginBottom: space.md }}>
        <NewPostButton size={56} />
      </View>
      {NAV_ITEMS.map((item) => (
        <TabTrigger key={item.name} name={item.name} asChild>
          <NavButton item={item} orientation="side" />
        </TabTrigger>
      ))}
      <View style={{ flex: 1 }} />
      <View style={{ alignItems: "center", borderRadius: radius.md }}>
        <ProfileButton />
      </View>
    </View>
  );
}
