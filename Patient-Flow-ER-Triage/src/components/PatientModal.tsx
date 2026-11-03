import React from 'react';
import type { Bay, Patient, StaffMember } from "../database/models";
import { View, Text, TouchableOpacity, Modal, ScrollView, SafeAreaView } from 'react-native';
import { X, HeartPulse, Droplets, Activity, Thermometer, Zap } from 'lucide-react-native';
import VitalBadge from './common/VitalBadge';

const ESI_COLORS: Record<number, string> = {
  1: "#ef4444",
  2: "#f97316",
  3: "#eab308",
  4: "#22c55e",
  5: "#3b82f6",
};

export function PatientModal({ patient, onClose, onTriage, busy, error, shared, bays, staff, onAction }: {
  patient?: Patient;
  onClose: () => void;
  onTriage?: (id: string, esi: number) => void;
  busy: boolean;
  error: string | null;
  shared: boolean;
  bays?: Bay[];
  staff?: StaffMember[];
  onAction?: (id: string, action: string, body: object) => void;
}) {
  if (!patient) return null;

  return (
    <Modal
      visible={!!patient}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 flex-row justify-end">
        {/* Transparent dark backdrop */}
        <TouchableOpacity 
          className="absolute inset-0 bg-black/20" 
          activeOpacity={1} 
          onPress={onClose} 
        />
        
        {/* Right-side panel */}
        <View className="w-[90%] max-w-[380px] bg-white h-full shadow-2xl border-l border-slate-200">
          <SafeAreaView className="flex-1">
            
            {/* Header */}
            <View className="px-5 h-[64px] flex flex-row items-center justify-between border-b border-slate-100 pt-2">
              <View className="flex flex-row items-center gap-3">
                <View className="h-9 w-9 rounded-full bg-slate-900 items-center justify-center">
                  <Text className="font-bold text-[12px] text-white">
                    {patient.id.split("-").at(-1)}
                  </Text>
                </View>
                <View className="flex flex-col">
                  <View className="flex flex-row items-center gap-2">
                    <Text className="text-[14px] font-semibold">{patient.id}</Text>
                    {patient.esi && (
                      <View 
                        className="h-5 px-2 rounded-full items-center justify-center"
                        style={{ backgroundColor: ESI_COLORS[patient.esi] }}
                      >
                        <Text className="text-[10px] font-bold text-white">ESI {patient.esi}</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-[11px] text-slate-500">
                    {patient.age}{patient.sex} • {patient.complaint}
                  </Text>
                </View>
              </View>
              <TouchableOpacity 
                onPress={onClose}
                className="h-8 w-8 rounded-full border border-slate-200 items-center justify-center bg-white"
              >
                <X size={16} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView className="flex-1 p-5" contentContainerStyle={{ gap: 20 }}>
              
              {!!error && <Text accessibilityRole="alert" className="text-red-800">{error}</Text>}
              {/* Vitals Section */}
              <View>
                <Text className="text-[11px] font-bold tracking-widest text-slate-400 mb-3">CURRENT VITALS</Text>
                {patient.vitals ? <><View className="flex flex-row flex-wrap gap-2">
                  <VitalBadge icon={HeartPulse} label="HR" value={patient.vitals.hr} warn={patient.vitals.hr > 120 || patient.vitals.hr < 50} />
                  <VitalBadge icon={Droplets} label="BP" value={`${patient.vitals.bpSys}/${patient.vitals.bpDia}`} warn={patient.vitals.bpSys < 90 || patient.vitals.bpSys > 180} />
                  <VitalBadge icon={Activity} label="SpO2" value={`${patient.vitals.spo2}%`} warn={patient.vitals.spo2 < 92} />
                </View>
                <View className="flex flex-row flex-wrap gap-2 mt-2">
                  <VitalBadge icon={Thermometer} label="Temp" value={`${patient.vitals.temp}°`} warn={patient.vitals.temp > 38.5} />
                  <VitalBadge icon={Zap} label="Pain" value={`${patient.pain}/10`} warn={patient.pain >= 8} />
                  <View className="flex-1" /> 
                </View></> : <Text className="text-xs text-slate-500">Vitals unavailable</Text>}
              </View>

              {/* Triage Actions (Only show if patient is in triage) */}
              {patient.status === 'triage' && onTriage && (
                <View className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
                  <Text className="text-[11px] font-bold tracking-widest text-slate-500 mb-3 text-center">ASSIGN ESI LEVEL</Text>
                  <View className="flex flex-col gap-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <TouchableOpacity
                        key={`triage-${i}`}
                        disabled={busy}
                        onPress={() => {
                          onTriage(patient.id, i);
                          if (!shared) onClose();
                        }}
                        style={{ backgroundColor: ESI_COLORS[i] }}
                        className="h-10 rounded-xl items-center justify-center shadow-sm flex flex-row gap-2"
                      >
                        <Text className="text-[13px] font-bold text-white">Assign ESI {i}</Text>
                        {patient.suggestedEsi === i && (
                          <View className="bg-white/20 px-2 py-0.5 rounded-full">
                            <Text className="text-[10px] text-white font-semibold">Suggested</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {onAction && patient.status === "waiting" && (
                <View className="gap-2">
                  <Text className="font-bold">Assign treatment bay</Text>
                  {bays?.filter((bay) => bay.status === "available").map((bay) => (
                    <TouchableOpacity key={bay.id} disabled={busy} className="rounded-lg bg-teal-900 p-3"
                      onPress={() => onAction(patient.id, "bay-assignment", { bay_id: String(bay.id) })}>
                      <Text className="text-white">{bay.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {!bays?.some((bay) => bay.status === "available") && <Text>No bays available</Text>}
                </View>
              )}
              {onAction && patient.status === "treatment" && (
                <View className="gap-2">
                  <Text className="font-bold">Assign available staff</Text>
                  {staff?.filter((member) => member.status === "Idle").map((member) => (
                    <TouchableOpacity key={member.id} disabled={busy} className="rounded-lg bg-teal-900 p-3"
                      onPress={() => onAction(patient.id, "staff-assignments", { staff_id: member.id })}>
                      <Text className="text-white">{member.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {(["discharged", "admitted"] as const).map((disposition) => (
                    <TouchableOpacity key={disposition} disabled={busy} className="rounded-lg bg-slate-800 p-3"
                      onPress={() => onAction(patient.id, "discharge", { disposition })}>
                      <Text className="text-white">{disposition === "discharged" ? "Discharge" : "Admit"}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Timeline Section */}
              <View>
                <Text className="text-[11px] font-bold tracking-widest text-slate-400 mb-3">TIMELINE</Text>
                <View className="border-l-2 border-slate-100 ml-2 pl-4 flex flex-col gap-4">
                  
                  {/* Default arrival event since mock data doesn't have a full timeline array */}
                  <View className="relative">
                    <View className="absolute -left-[23px] top-0 h-3 w-3 rounded-full bg-slate-200 border-2 border-white" />
                    <Text className="text-[10px] font-mono text-slate-400 mb-1">{shared ? new Date(patient.arrivalTs * 1000).toLocaleTimeString() : `T+${patient.arrivalTs}s`}</Text>
                    <Text className="text-[12px] text-slate-700">Arrived at ER - {patient.complaint}</Text>
                  </View>

                  {patient.waitStartTs !== null && (
                    <View className="relative">
                      <View className="absolute -left-[23px] top-0 h-3 w-3 rounded-full bg-amber-400 border-2 border-white" />
                      <Text className="text-[10px] font-mono text-slate-400 mb-1">{shared ? new Date(patient.waitStartTs * 1000).toLocaleTimeString() : `T+${patient.waitStartTs}s`}</Text>
                      <Text className="text-[12px] text-slate-700">Triaged as ESI {patient.esi}. Moved to waiting room.</Text>
                    </View>
                  )}

                  {patient.status === 'treatment' && (
                    <View className="relative">
                      <View className="absolute -left-[23px] top-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-white" />
                      <Text className="text-[10px] font-mono text-slate-400 mb-1">Current</Text>
                      <Text className="text-[12px] text-slate-700">Admitted to Bay {patient.bedId} for treatment.</Text>
                    </View>
                  )}

                </View>
              </View>

            </ScrollView>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}
