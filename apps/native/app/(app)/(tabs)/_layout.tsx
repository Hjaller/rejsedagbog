import { TabList, TabSlot, TabTrigger, Tabs } from "expo-router/ui";
import { View } from "react-native";

import { BottomBar, NAV_ITEMS, SideBar } from "@/components/app-navigation";
import { useBreakpoint } from "@/lib/breakpoints";
import { usePalette } from "@/lib/theme";

/**
 * Responsiv navigation (kravspec afsnit 4) med headless tabs fra expo-router/ui:
 * bundbar med "+" i midten under 600 dp, sidebar fra 600 dp. Den skjulte TabList
 * registrerer fanerne; BottomBar/SideBar tegner dem med <TabTrigger asChild>.
 */
export default function TabsLayout() {
  const p = usePalette();
  const compact = useBreakpoint() === "compact";

  return (
    <Tabs style={{ flex: 1, flexDirection: compact ? "column" : "row", backgroundColor: p.background }}>
      {compact ? null : <SideBar />}
      <View style={{ flex: 1 }}>
        <TabSlot style={{ flex: 1 }} />
      </View>
      {compact ? <BottomBar /> : null}
      <TabList style={{ display: "none" }}>
        {NAV_ITEMS.map((item) => (
          <TabTrigger key={item.name} name={item.name} href={item.href} />
        ))}
      </TabList>
    </Tabs>
  );
}
