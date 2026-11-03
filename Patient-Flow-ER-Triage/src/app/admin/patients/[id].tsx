import { useLocalSearchParams, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useAdminService } from "../../../components/admin/useAdminService";
import { useAuth } from "../../../auth/AuthProvider";
import type { PatientRecord } from "../../../database/models";

function DetailSection({ title, rows, render }: { title: string; rows: any[]; render: (row: any) => string }) {
  return <View className="gap-2 rounded-2xl border border-slate-200 bg-white p-4"><Text className="text-lg font-bold">{title}</Text>{rows.length ? rows.map((row, index) => <Text key={row.id ?? index} className="text-sm text-slate-700">{render(row)}</Text>) : <Text className="text-sm text-slate-500">No records</Text>}</View>;
}

export default function PatientDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const service = useAdminService();
  const { can } = useAuth();
  const saving = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<[PatientRecord | null, any[], any[], any[], any[]] | null>(null);
  const [error, setError] = useState("");
  const [visitOpen, setVisitOpen] = useState(false);
  const [complaint, setComplaint] = useState("");
  useEffect(() => {
    let active = true;
    void service.then((api) => api.patients.details(Number(id))).then((result) => {
      if (active) setData(result);
    }).catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [id, service, retry]);

  async function createVisit() {
    if (saving.current || !complaint.trim()) return;
    saving.current = true;
    setSubmitting(true);
    setError("");
    try {
      const api = await service;
      await api.patients.createEncounter(Number(id), complaint);
      setComplaint("");
      setVisitOpen(false);
      setRetry((value) => value + 1);
    } catch (cause) {
      setError(String(cause));
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  }

  if (error && !data) return <View className="gap-2 p-4">
    <Text accessibilityRole="alert" className="text-red-700">{error}</Text>
    <Pressable accessibilityRole="button" onPress={() => { setError(""); setRetry((value) => value + 1); }}>
      <Text className="font-semibold text-teal-900">Retry patient details</Text>
    </Pressable>
  </View>;
  if (!data) return <Text className="p-4">Loading patient details…</Text>;
  const [patient, encounters, assessments, events, assignments] = data;
  if (!patient) return <Text className="p-4">Patient record was not found.</Text>;
  return <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 14 }}>
    <Pressable onPress={() => router.back()}><Text className="font-semibold text-teal-800">← Back to Patient Management</Text></Pressable>
    <View className="flex-row flex-wrap items-center justify-between gap-3"><View><Text accessibilityRole="header" className="text-2xl font-bold">{[patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(" ") || "Unidentified Patient"}</Text><Text className="text-slate-600">{patient.patientCode} · {patient.sex}</Text></View>{can("patients:write") && <Pressable accessibilityRole="button" onPress={() => setVisitOpen(true)} className="rounded-xl bg-teal-900 px-4 py-3"><Text className="font-bold text-white">Start New ER Visit</Text></Pressable>}</View>
    {!!error && !visitOpen && <Text accessibilityRole="alert" className="text-red-700">{error}</Text>}
    <DetailSection title="Encounter History" rows={encounters} render={(row) => `${row.encounterCode} · ${row.arrivalAt} · ${row.status} · ${row.chiefComplaint}`} />
    <DetailSection title="Triage Assessments" rows={assessments} render={(row) => `ESI ${row.esi} · ${row.assessedAt}${row.notes ? ` · ${row.notes}` : ""}`} />
    <DetailSection title="Bay and Staff Assignments" rows={assignments} render={(row) => `${row.bayName ?? row.staffName} · ${row.assignedAt}${row.releasedAt ? ` · released ${row.releasedAt}` : " · active"}`} />
    <DetailSection title="Event History" rows={events} render={(row) => `${row.createdAt} · ${row.category} · ${row.text}`} />
    <Modal visible={visitOpen} transparent animationType="fade" onRequestClose={() => setVisitOpen(false)}><View className="flex-1 items-center justify-center bg-slate-950/50 p-4"><View className="w-full max-w-[480px] gap-3 rounded-2xl bg-white p-5"><Text accessibilityRole="header" className="text-xl font-bold">Start New ER Visit</Text><Text className="text-sm text-slate-600">This creates a new encounter for the existing patient identity and places it in intake.</Text><TextInput accessibilityLabel="New visit chief complaint" value={complaint} onChangeText={setComplaint} placeholder="Chief complaint" className="min-h-11 rounded-xl border border-slate-300 px-3" />{!!error && <Text accessibilityRole="alert" className="text-red-700">{error}</Text>}<View className="flex-row justify-end gap-2"><Pressable onPress={() => setVisitOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2"><Text>Cancel</Text></Pressable><Pressable disabled={submitting || !complaint.trim()} onPress={createVisit} className="rounded-lg bg-teal-900 px-4 py-2"><Text className="font-bold text-white">Create Visit</Text></Pressable></View></View></View></Modal>
  </ScrollView>;
}
