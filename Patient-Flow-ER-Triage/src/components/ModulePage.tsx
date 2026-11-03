import type { PropsWithChildren } from "react";
import { ScrollView, Text } from "react-native";

/** Gives simulation modules a consistent heading and scrollable page. */
export function ModulePage({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Text accessibilityRole="header" className="text-2xl font-bold text-slate-900">{title}</Text>
      {children}
    </ScrollView>
  );
}
