import { localMode } from "../api/client";
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Users, TriangleAlert } from 'lucide-react-native';

const ESI_COLORS: Record<number, string> = {
  1: "#ef4444",
  2: "#f97316",
  3: "#eab308",
  4: "#22c55e",
  5: "#3b82f6",
};

// Changed to named export to match your dashboard imports
export function WaitingRoom({ patients, simTime, onSelect }: any) {
  return (
    <View className="rounded-[20px] bg-slate-900 border border-slate-800 shadow-sm overflow-hidden flex flex-col flex-1">
      
      {/* Header */}
      <View className="px-4 h-[52px] flex flex-row items-center justify-between">
        <View className="flex flex-row items-center gap-2">
          <Users size={16} color="white" />
          <Text className="text-[13px] font-semibold tracking-wide text-white">
            WAITING ROOM
          </Text>
          <View className="ml-2 h-5 min-w-[20px] px-1.5 rounded-full bg-white items-center justify-center">
            <Text className="text-slate-900 text-[10px] font-bold">
              {patients.length}
            </Text>
          </View>
        </View>
        <Text className="text-[11px] text-slate-400 hidden sm:flex">
          Sorted by ESI
        </Text>
      </View>

      {/* Patient List Container */}
      <View className="px-3 pb-3 flex-1">
        <View className="rounded-[14px] bg-white/5 border border-white/10 p-2 flex-1">
          <ScrollView 
            className="max-h-[300px]" 
            contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
          >
            {patients.length === 0 ? (
              <View className="items-center py-6">
                <Text className="text-[12px] text-slate-400 text-center">
                  No patients waiting. Triage inbox feeds here.
                </Text>
              </View>
            ) : (
              patients.map((r: any) => {
                // FIXED: Restored the subtraction operator
                const waitTime = r.waitStartTs !== null ? simTime - r.waitStartTs : 0;
                const isRisk = localMode && waitTime > 60; // LWBS (Left Without Being Seen) Risk threshold

                return (
                  <TouchableOpacity
                    key={r.id}
                    onPress={() => onSelect(r.id)}
                    className={`flex flex-row items-center gap-3 rounded-xl border px-3 py-2 ${
                      isRisk 
                        ? "bg-red-500/15 border-red-500/30" 
                        : "bg-white/5 border-white/10"
                    }`}
                  >
                    {/* ESI Badge */}
                    <View 
                      className="h-7 w-7 rounded-full items-center justify-center"
                      style={{ backgroundColor: r.esi ? ESI_COLORS[r.esi] : "#64748b" }}
                    >
                      <Text className="text-[11px] font-bold text-white">
                        {r.esi}
                      </Text>
                    </View>

                    {/* Patient Details */}
                    <View className="flex-1">
                      <View className="flex flex-row items-center gap-2">
                        <Text className="text-[12px] font-semibold text-white">
                          {r.id}
                        </Text>
                        <Text 
                          className="text-[11px] text-slate-300 flex-1" 
                          numberOfLines={1}
                        >
                          {r.complaint}
                        </Text>
                        
                        {isRisk && (
                          <View className="flex flex-row items-center gap-1">
                            <TriangleAlert size={12} color="#fca5a5" />
                            <Text className="text-[10px] font-bold text-red-300">
                              LWBS RISK
                            </Text>
                          </View>
                        )}
                      </View>
                      
                      <View className="mt-0.5 flex flex-row items-center gap-2">
                        <Text className="text-[11px] text-slate-400">
                          {r.age}{r.sex}
                        </Text>
                        <Text className="text-[11px] text-slate-400">
                          {r.vitals ? `• HR ${r.vitals.hr} • SpO2 ${r.vitals.spo2}%` : "Vitals unavailable"}
                        </Text>
                      </View>
                    </View>

                    {/* Wait Time */}
                    <View className="items-end justify-center">
                      <Text className={`text-[12px] font-bold tabular-nums ${isRisk ? "text-red-300" : "text-white"}`}>
                        {waitTime}s
                      </Text>
                      <Text className="text-[10px] text-slate-400">wait</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}