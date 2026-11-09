import { localMode } from "../api/client";
import React from "react";
import { View, Text, ScrollView } from "react-native";
import { Activity } from 'lucide-react-native';

export function EventLog({ events }: any) {
  return (
    <View className="flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      
      {/* Header */}
      <View className="h-11 flex-row items-center justify-between border-b border-slate-100 px-3">
        <View className="flex flex-row items-center gap-2">
          <Activity size={16} color="#0f172a" />
          <Text className="text-xs font-semibold tracking-wide text-slate-900">
            EVENT LOG
          </Text>
        </View>
        {/* Pulsing indicator (NativeWind translates this if configured, otherwise standard static dot) */}
        <View className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
      </View>

      {/* Events List */}
      <ScrollView className="max-h-[300px] p-2" contentContainerStyle={{ gap: 4 }}>
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
              className={`rounded-lg border px-2.5 py-1.5 ${containerStyle} flex-row items-start`}
            >
              <Text className="mr-2 mt-[1px] font-mono text-[10px] text-slate-600">
                {localMode ? `T+${n.ts}s` : new Date(n.ts * 1000).toLocaleTimeString()}
              </Text>
              <Text className={`flex-1 text-[11px] leading-[15px] ${textStyle}`}>
                <Text className="font-semibold">{n.category} · </Text>{n.text} ({n.type})
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
