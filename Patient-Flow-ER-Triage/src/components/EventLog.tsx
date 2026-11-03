import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Activity } from 'lucide-react-native';

export function EventLog({ events }: any) {
  return (
    <View className="rounded-[20px] bg-white border border-slate-200 shadow-sm overflow-hidden flex flex-col flex-1">
      
      {/* Header */}
      <View className="px-4 h-[52px] flex flex-row items-center justify-between border-b border-slate-100">
        <View className="flex flex-row items-center gap-2">
          <Activity size={16} color="#0f172a" />
          <Text className="text-[13px] font-semibold tracking-wide text-slate-900">
            EVENT LOG
          </Text>
        </View>
        {/* Pulsing indicator (NativeWind translates this if configured, otherwise standard static dot) */}
        <View className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
      </View>

      {/* Events List */}
      <ScrollView className="p-2 max-h-[420px]" contentContainerStyle={{ gap: 6 }}>
        {events.map((n: any) => {
          // Determine styles based on event type
          let containerStyle = "bg-slate-50 border-slate-200";
          let textStyle = "text-slate-700";

          if (n.type === "critical") {
            containerStyle = "bg-red-50 border-red-200";
            textStyle = "text-red-800";
          } else if (n.type === "warn") {
            containerStyle = "bg-amber-50 border-amber-100";
            textStyle = "text-amber-800";
          } else if (n.type === "success") {
            containerStyle = "bg-emerald-50 border-emerald-100";
            textStyle = "text-emerald-800";
          }

          return (
            <View 
              key={n.id} 
              className={`rounded-xl px-3 py-2 border flex flex-row items-start ${containerStyle}`}
            >
              <Text className="font-mono text-[10px] text-slate-600 mr-2 mt-[1px]">
                T+{n.ts}s
              </Text>
              <Text className={`text-[11px] leading-[15px] flex-1 ${textStyle}`}>
                <Text className="font-semibold">{n.category} · </Text>{n.text} ({n.type})
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}