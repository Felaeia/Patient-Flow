import type { Bay, FlowEvent, Patient, StaffMember } from "../database/models";
import type { FlowSnapshot } from "../simulation/patientFlow";
import type { Client } from "./client";

interface Dashboard {
  now: string;
  counts: { status: string; total: number }[];
  patients: {
    id: string; name?: string; age?: number; sex?: string; chief_complaint?: string; status: Patient["status"];
    vitals?: Patient["vitals"]; pain?: number; suggested_esi?: number; assessed_esi: number | null;
    arrival_at: string; queue_entered_at: string | null; bay_id: string | null;
  }[];
  staff: (Omit<StaffMember, "assignedPatientId"> & { assigned_patient_id: string | null })[];
  bays: (Omit<Bay, "id"> & { id: string })[];
  events: { id: string; type: FlowEvent["type"]; created_at: string; category: string; message: string; encounter_id: string | null }[];
}

export function apiFlow(request: Client) {
  const second = (value: string) => Math.floor(Date.parse(value) / 1000);
  async function load(): Promise<FlowSnapshot> {
    const result = await request<Dashboard>("/dashboard");
    const simTime = second(result.now);
    const patients = result.patients.map((row): Patient => ({
      id: row.id, name: row.name, age: row.age ?? 0, sex: row.sex ?? "", complaint: row.chief_complaint ?? "",
      vitals: row.vitals ?? null, pain: row.pain ?? 0,
      suggestedEsi: row.suggested_esi ?? 0, esi: row.assessed_esi, status: row.status,
      arrivalTs: second(row.arrival_at), triageStartTs: second(row.arrival_at),
      waitStartTs: row.queue_entered_at ? second(row.queue_entered_at) : null,
      bedId: row.bay_id ? Number(row.bay_id) : null, treatmentProgress: 0,
    }));
    const bays = result.bays.map((row) => ({ ...row, id: Number(row.id) }));
    const staff = result.staff.map((row) => ({ ...row, assignedPatientId: row.assigned_patient_id }));
    const events = result.events.map((row): FlowEvent => ({
      id: row.id, ts: second(row.created_at), category: row.category, text: row.message,
      patientId: row.encounter_id ?? undefined, type: row.type,
    }));
    const waiting = patients.filter((row) => row.status === "waiting");
    const count = (status: string) => result.counts.find((row) => row.status === status)?.total ?? 0;
    return {
      simTime, patients, bays, staff, events,
      metrics: {
        total: result.counts.reduce((sum, row) => sum + row.total, 0), waiting: count("waiting"),
        treatment: count("treatment"), discharged: count("discharged"), admitted: count("admitted"),
        availableBays: bays.filter((row) => row.status === "available").length,
        occupiedBays: bays.filter((row) => row.status === "occupied").length,
        availableStaff: staff.filter((row) => row.status === "Idle").length,
        averageWait: waiting.length ? Math.round(waiting.reduce((sum, row) => sum + Math.max(0, simTime - (row.waitStartTs ?? simTime)), 0) / waiting.length) : 0,
      },
    };
  }
  return {
    load, tick: load,
    async triage(id: string, esi: number) {
      await request("/encounters/" + id + "/triage", "POST", { esi });
      return load();
    },
  };
}
