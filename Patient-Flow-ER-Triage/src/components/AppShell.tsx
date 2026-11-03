import { useState } from "react";
import type { PropsWithChildren } from "react";
import { Menu } from "lucide-react-native";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Sidebar } from "./Sidebar";

/** Keeps navigation mounted around the current route and adapts it to the viewport. */
export function AppShell({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();
  const mobile = width < 768;
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isCollapsed = collapsed ?? width < 1100;
  const closeDrawer = () => setDrawerOpen(false);

  return (
    <SafeAreaView className="flex-1 bg-[#f6f7f9]">
      {mobile && (
        <View className="flex-row items-center gap-2 border-b border-slate-200 bg-white px-3 py-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open navigation"
            accessibilityState={{ expanded: drawerOpen }}
            onPress={() => setDrawerOpen(true)}
            className="h-11 w-11 items-center justify-center rounded-lg border border-transparent hover:bg-slate-100 focus:border-teal-700"
          >
            <Menu size={22} color="#0f172a" />
          </Pressable>
          <Text className="text-lg font-bold text-slate-900">TriFlow</Text>
        </View>
      )}
      <View className="flex-1 flex-row">
        {!mobile && (
          <View style={{ zIndex: 1 }} className="bg-slate-900">
            <Sidebar collapsed={isCollapsed} onToggle={() => setCollapsed(!isCollapsed)} />
          </View>
        )}
        <View className="min-w-0 flex-1">{children}</View>
      </View>
      <Modal visible={mobile && drawerOpen} transparent animationType="fade" onRequestClose={closeDrawer}>
        <SafeAreaView className="flex-1 bg-slate-950/50">
          <View className="flex-1 flex-row">
            <Sidebar onClose={closeDrawer} />
            <Pressable
              accessible={false}
              importantForAccessibility="no"
              tabIndex={-1}
              className="flex-1"
              onPress={closeDrawer}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
