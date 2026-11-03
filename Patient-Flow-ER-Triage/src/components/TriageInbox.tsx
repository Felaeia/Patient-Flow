import { localMode } from "../api/client";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import {
  Stethoscope,
  Activity,
  HeartPulse,
  Droplets,
  Thermometer,
  Zap,
  TriangleAlert,
  Clock,
} from "lucide-react-native";
import VitalBadge from "./common/VitalBadge";

const ESI_COLORS: Record<number, string> = {
  1: "#ef4444",
  2: "#f97316",
  3: "#eab308",
  4: "#22c55e",
  5: "#3b82f6",
};

const ESI_LABELS: Record<number, string> = {
  1: "Resuscitation",
  2: "Emergent",
  3: "Urgent",
  4: "Less",
  5: "Non-urgent",
};

// Changed to named export to match your dashboard imports
export function TriageInbox({ patients, simTime, onTriage, onSelect, busy }: any) {
  return (
    <View className="rounded-[20px] bg-white border border-slate-200 shadow-sm overflow-hidden flex flex-col flex-1">
      {/* Header */}
      <View className="px-4 h-[52px] flex flex-row items-center justify-between border-b border-slate-100">
        <View className="flex flex-row items-center gap-2">
          <View className="h-7 w-7 rounded-full bg-slate-900 items-center justify-center">
            <Stethoscope size={16} color="white" />
          </View>
          <Text className="text-[13px] font-semibold tracking-wide">
            TRIAGE INBOX
          </Text>
          <View className="ml-1 h-5 min-w-[20px] px-1.5 rounded-full bg-slate-900 items-center justify-center">
            <Text className="text-[10px] font-bold text-white">
              {patients.length}
            </Text>
          </View>
        </View>
        <Text className="text-[11px] text-slate-500">New arrivals</Text>
      </View>

      {/* Inbox List */}
      <ScrollView
        className="p-3 max-h-[760px]"
        contentContainerStyle={{ paddingBottom: 12, gap: 12 }}
      >
        {patients.length === 0 ? (
          <View className="rounded-2xl border border-dashed border-slate-200 p-8 items-center justify-center">
            <View className="h-10 w-10 rounded-full bg-slate-50 items-center justify-center mb-3">
              <Activity size={20} color="#94a3b8" />
            </View>
            <Text className="text-[13px] font-medium text-slate-700">
              All caught up
            </Text>
            <Text className="text-[11px] text-slate-500 mt-1 text-center">
              No patients awaiting triage.
            </Text>
          </View>
        ) : (
          patients.map((p: any) => {
            // FIXED: Restored the subtraction operator
            const waitTime = simTime - p.triageStartTs;
            const isDelayed = localMode && waitTime > 25;

            return (
              <View
                key={p.id}
                className={`rounded-[16px] border p-3 shadow-sm ${isDelayed ? "border-red-200 bg-red-50/50" : "border-slate-200 bg-white"}`}
              >
                {/* Patient Header Row */}
                <View className="flex flex-row items-start justify-between">
                  <View className="flex flex-row items-center gap-2 flex-1">
                    <View className="h-8 w-8 rounded-full bg-slate-900 items-center justify-center">
                      <Text className="text-[11px] font-bold text-white">
                        {p.id.split("-").at(-1)}
                      </Text>
                    </View>
                    <View className="flex flex-col flex-1">
                      <View className="flex flex-row items-center gap-1.5 flex-wrap">
                        <Text className="text-[13px] font-semibold">
                          {p.id}
                        </Text>
                        <View className="px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200">
                          <Text className="text-[11px]">
                            {p.age}
                            {p.sex}
                          </Text>
                        </View>
                        {!!p.suggestedEsi && <View
                          className="px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: ESI_COLORS[p.suggestedEsi],
                          }}
                        >
                          <Text className="text-[10px] font-bold tracking-wide text-white">
                            SUG ESI-{p.suggestedEsi}
                          </Text>
                        </View>}
                      </View>
                      <View className="mt-0.5 flex flex-row items-center gap-1">
                        <TriangleAlert size={12} color="#94a3b8" />
                        <Text className="text-[12px] font-medium text-slate-700">
                          {p.complaint}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => onSelect(p.id)}
                    className="h-7 px-2.5 rounded-full border border-slate-200 bg-white items-center justify-center"
                  >
                    <Text className="text-[11px] font-medium text-slate-700">
                      Details
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Vitals Grid */}
                {p.vitals ? <View className="mt-2.5 flex flex-row flex-wrap gap-1.5">
                  <VitalBadge
                    icon={HeartPulse}
                    label="HR"
                    value={`${p.vitals.hr}`}
                    warn={p.vitals.hr > 120 || p.vitals.hr < 50}
                  />
                  <VitalBadge
                    icon={Droplets}
                    label="BP"
                    value={`${p.vitals.bpSys}/${p.vitals.bpDia}`}
                    warn={p.vitals.bpSys < 90 || p.vitals.bpSys > 180}
                  />
                  <VitalBadge
                    icon={Activity}
                    label="SpO2"
                    value={`${p.vitals.spo2}%`}
                    warn={p.vitals.spo2 < 92}
                  />
                  <VitalBadge
                    icon={Thermometer}
                    label="Temp"
                    value={`${p.vitals.temp}°`}
                    warn={p.vitals.temp > 38.5}
                  />
                  <VitalBadge
                    icon={Zap}
                    label="Pain"
                    value={`${p.pain}/10`}
                    warn={p.pain >= 8}
                  />
                </View> : <Text className="mt-2 text-xs text-slate-500">Vitals unavailable</Text>}

                {/* Timers */}
                <View className="mt-3 flex flex-row items-center justify-between">
                  <View className="flex flex-row items-center gap-1">
                    <Clock
                      size={12}
                      color={isDelayed ? "#dc2626" : "#64748b"}
                    />
                    <Text
                      className={`text-[11px] ${isDelayed ? "text-red-600 font-semibold" : "text-slate-500"}`}
                    >
                      waiting {waitTime}s {isDelayed && "• triage delayed"}
                    </Text>
                  </View>
                  <Text className="text-[10px] text-slate-400">
                    {localMode ? `T+${p.arrivalTs}s` : new Date(p.arrivalTs * 1000).toLocaleTimeString()}
                  </Text>
                </View>

                {/* ESI Triage Action Buttons */}
                <View className="mt-3 flex flex-row gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <TouchableOpacity
                      key={i}
                      accessibilityRole="button"
                      accessibilityLabel={`Assign ESI ${i} to encounter ${p.id}`}
                      disabled={busy || !onTriage}
                      onPress={() => onTriage?.(p.id, i)}
                      style={{
                        backgroundColor: ESI_COLORS[i],
                        borderWidth: p.suggestedEsi === i ? 2 : 0,
                        borderColor: "#000",
                      }}
                      className="h-8 flex-1 rounded-full items-center justify-center shadow-sm"
                    >
                      <Text className="text-[11px] font-bold text-white">
                        {i}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* ESI Triage Labels */}
                <View className="mt-1.5 flex flex-row gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Text
                      key={`label-${i}`}
                      className="flex-1 text-center text-[10px] text-slate-500"
                      numberOfLines={1}
                    >
                      {ESI_LABELS[i]}
                    </Text>
                  ))}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
