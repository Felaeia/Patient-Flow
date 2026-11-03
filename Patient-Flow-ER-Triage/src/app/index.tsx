import { localMode } from "../api/client";
import { BedDouble, ClipboardList, Clock, HeartPulse, LogIn, LogOut, Users } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";
import { EventLog } from "../components/EventLog";
import PipelineStep from "../components/common/PipelineStep";
import StatCard from "../components/common/StatCard";
import { useSimulation } from "../components/SimulationProvider";

/** Shows current shift metrics, patient distribution, and recent activity. */
export default function Dashboard() {
  const { patients, events, simTime, metrics } = useSimulation();
  const arrivals = patients.filter((patient) => patient.status === "triage" && (localMode ? patient.arrivalTs === simTime : simTime - patient.arrivalTs <= 3));
  const triage = patients.filter((patient) => patient.status === "triage").length - arrivals.length;
  const admitted = metrics.admitted ?? patients.filter((patient) => patient.status === "admitted").length;
  const cards = [
    { title: "Total Patients", value: metrics.total, icon: Users },
    { title: "Patients Waiting", value: metrics.waiting, icon: Clock },
    { title: "Patients Under Treatment", value: metrics.treatment, icon: HeartPulse },
    { title: "Patients Discharged", value: metrics.discharged, icon: LogOut },
    { title: "Available Treatment Bays", value: metrics.availableBays, icon: BedDouble },
    { title: "Occupied Treatment Bays", value: metrics.occupiedBays, icon: BedDouble },
    { title: "Available Medical Staff", value: metrics.availableStaff, icon: Users },
    { title: "Average Patient Waiting Time", value: `${metrics.averageWait}s`, icon: Clock },
  ];
  const stages = [
    { label: "Arrival", count: arrivals.length, icon: LogIn },
    { label: "Triage", count: triage, icon: ClipboardList },
    { label: "Waiting Room", count: metrics.waiting, icon: Users },
    { label: "Treatment", count: metrics.treatment, icon: BedDouble },
    { label: "Discharge", count: metrics.discharged, icon: LogOut },
  ];

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View className="flex-row flex-wrap items-start justify-between gap-2">
        <View>
          <Text accessibilityRole="header" className="text-2xl font-bold text-slate-900">Dashboard</Text>
          <Text className="mt-1 text-sm text-slate-600">Emergency department patient flow</Text>
        </View>
        <Text className="rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-900">
          {localMode ? `Simulated shift · T+${simTime}s` : "Shared ER dashboard"}
        </Text>
      </View>

      <View className="flex-row flex-wrap gap-3">
        {cards.map((metric) => (
          <View key={metric.title} style={{ flexBasis: 196, flexGrow: 1, maxWidth: "100%" }}>
            <StatCard {...metric} />
          </View>
        ))}
      </View>

      <View className="gap-3 rounded-[20px] border border-slate-200 bg-white p-4">
        <Text accessibilityRole="header" className="text-base font-semibold text-slate-900">Patient Flow Overview</Text>
        <View className="flex-row flex-wrap gap-3">
          {stages.map((stage, index) => (
            <View key={stage.label} className="rounded-xl bg-slate-50 p-2" style={{ flexBasis: 158, flexGrow: 1 }}>
              <PipelineStep {...stage} label={`${index + 1}. ${stage.label}`} isLast />
            </View>
          ))}
        </View>
        <Text className="text-xs text-slate-600">Admitted to hospital · {admitted}</Text>
      </View>

      <EventLog events={events} />
    </ScrollView>
  );
}
