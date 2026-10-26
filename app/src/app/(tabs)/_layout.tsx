import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";

export default function TabLayout() {
  const t = useTheme();
  const { compareIds } = useStore();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        headerStyle: { backgroundColor: t.card },
        headerTintColor: t.text,
        sceneStyle: { backgroundColor: t.bg },
        // On Android the tab bar would otherwise ride up on top of the keyboard.
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "SmartShop",
          tabBarLabel: "Assistant",
          tabBarIcon: ({ color, size }) => <Ionicons name="sparkles-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="compare"
        options={{
          title: "Compare",
          tabBarBadge: compareIds.length || undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="git-compare-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Preferences",
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
