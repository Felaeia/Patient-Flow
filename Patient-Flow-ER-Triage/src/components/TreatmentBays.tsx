import { localMode } from "../api/client";
import type { Bay } from "../database/models";
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { BedDouble } from 'lucide-react-native';

// Constants mapped from the HTML artifact[cite: 2]
const ESI_COLORS: Record<number, string> = {
  1: "#ef4444",
  2: "#f97316",
  3: "#eab308",
  4: "#22c55e",
  5: "#3b82f6",
};

const ESI_TREATMENT_TIME: Record<number, number> = {
  1: 20, 2: 30, 3: 45, 4: 25, 5: 15
};

export function TreatmentBays({ beds, treatmentPatients, staff, onSelect }: any) {
  return (
    <View className="rounded-[20px] bg-white border border-slate-200 shadow-sm overflow-hidden flex flex-col flex-1">
      
      {/* Header */}
      <View className="px-4 h-[52px] flex flex-row items-center justify-between border-b border-slate-100">
        <View className="flex flex-row items-center gap-2">
          <BedDouble size={16} color="#0f172a" />
          <Text className="text-[13px] font-semibold tracking-wide text-slate-900">
            TREATMENT BAYS
          </Text>
          <Text className="ml-2 text-[11px] text-slate-500">
            {treatmentPatients.length} / {beds.length} occupied
          </Text>
        </View>
        
        {/* Status Indicators */}
        <View className="flex flex-row items-center gap-3">
          <View className="flex flex-row items-center gap-1">
            <View className="h-2 w-2 rounded-full bg-emerald-500" />
            <Text className="text-[11px] text-slate-600 hidden sm:flex">Active</Text>
          </View>
          <View className="flex flex-row items-center gap-1">
            <View className="h-2 w-2 rounded-full bg-slate-200" />
            <Text className="text-[11px] text-slate-600 hidden sm:flex">Free</Text>
          </View>
        </View>
      </View>

      {/* Bays List / Grid */}
      <View className="p-3 flex flex-col gap-3">
        {beds.map(({ id: bedId, status }: Bay) => {
          const patient = treatmentPatients.find((p: any) => p.bedId === bedId);
          const assignedStaff = staff.filter((s: any) => s.assignedPatientId === patient?.id);

          // Free Bed State
          if (!patient) {
            return (
              <View 
                key={`bed-${bedId}`} 
                className="rounded-[16px] border border-dashed border-slate-200 bg-[#fbfcfe] p-4 h-[132px] flex flex-col justify-between"
              >
                <View className="flex flex-row items-center justify-between">
                  <Text className="text-[11px] font-bold tracking-widest text-slate-400">
                    BAY {bedId}
                  </Text>
                  <View className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200">
                    <Text className="text-[10px] font-bold text-slate-500">{status === "unavailable" ? "UNAVAILABLE" : "FREE"}</Text>
                  </View>
                </View>
                <Text className="text-[12px] text-slate-400">
                  {status === "unavailable" ? "Out of service" : "Ready for ESI priority assignment"}
                </Text>
                <View className="h-1.5 w-full rounded-full bg-slate-100" />
              </View>
            );
          }

          // Occupied Bed State
          return (
            <TouchableOpacity 
              key={`bed-${bedId}`}
              onPress={() => onSelect(patient.id)}
              className="rounded-[16px] border border-slate-200 bg-white p-3 shadow-sm"
            >
              {/* Top Row: Bay ID & Badges */}
              <View className="flex flex-row items-start justify-between">
                <View className="flex flex-row items-center gap-2">
                  <Text className="text-[11px] font-bold tracking-widest text-slate-500">
                    BAY {bedId}
                  </Text>
                  <View 
                    className="h-6 px-2 rounded-full items-center justify-center"
                    style={{ backgroundColor: patient.esi ? ESI_COLORS[patient.esi] : "#64748b" }}
                  >
                    <Text className="text-[11px] font-bold text-white">
                      ESI-{patient.esi}
                    </Text>
                  </View>
                </View>
                <View className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200">
                  <Text className="text-[10px] font-bold text-emerald-700">OCCUPIED</Text>
                </View>
              </View>

              {/* Middle: Patient Info */}
              <View className="mt-2 flex flex-row items-center gap-2">
                <Text className="text-[13px] font-semibold text-slate-900">
                  {patient.id}
                </Text>
                <Text className="text-[11px] text-slate-500 flex-1" numberOfLines={1}>
                  {patient.complaint}
                </Text>
              </View>

              {/* Staff Assignment Badges */}
              <View className="mt-2 flex flex-row items-center gap-1.5 flex-wrap">
                {assignedStaff.length > 0 ? (
                  assignedStaff.map((s: any) => (
                    <View key={s.id} className="px-2 py-0.5 rounded-full bg-slate-900">
                      <Text className="text-[10px] text-white">
                        {s.name.split(" ")[0]} {s.role[0]}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text className="text-[10px] text-slate-400">
                    {localMode ? "Auto-assigning staff…" : "No staff assigned"}
                  </Text>
                )}
              </View>

              {/* Progress Bar */}
              {localMode && <View className="mt-3 flex flex-col gap-1">
                <View className="flex flex-row justify-between">
                  <Text className="text-[10px] text-slate-500">Treatment</Text>
                  <Text className="text-[10px] text-slate-500 tabular-nums">
                    {Math.round(patient.treatmentProgress || 0)}%
                  </Text>
                </View>
                
                <View className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <View 
                    className="h-full rounded-full"
                    style={{ 
                      width: `${patient.treatmentProgress || 0}%`, 
                      backgroundColor: patient.esi ? ESI_COLORS[patient.esi] : "#0f172a" 
                    }} 
                  />
                </View>
                
                <Text className="mt-1 text-[10px] text-slate-400">
                  Est {patient.esi ? ESI_TREATMENT_TIME[patient.esi] : 30}s â€¢ x1.35 with staff
                </Text>
              </View>}

            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
