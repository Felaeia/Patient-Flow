export interface Patient {
  id: string;
  name?: string | null;
  age: number;
  sex: string;
  complaint: string;
  vitals: { hr: number; bpSys: number; bpDia: number; spo2: number; temp: number };
  pain: number;
  esi: number | null;
  suggestedEsi: number;
  status: "triage" | "waiting" | "treatment" | "discharged" | "admitted";
  arrivalTs: number;
  triageStartTs: number;
  waitStartTs: number | null;
  bedId: number | null;
  treatmentProgress: number;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  status: "Idle" | "Busy" | "Unavailable";
  assignedPatientId: string | null;
}

export interface FlowEvent {
  id: string;
  ts: number;
  type: "info" | "success" | "warn" | "critical";
  category: string;
  text: string;
  patientId?: string;
}

export interface DashboardMetrics {
  total: number;
  waiting: number;
  treatment: number;
  discharged: number;
  availableBays: number;
  occupiedBays: number;
  availableStaff: number;
  averageWait: number;
}

export interface Bay { id: number; name: string; status: "available" | "occupied" | "unavailable" }
export interface Assessment { id: number; patientId: string; esi: number; notes: string | null; assessedBy: string | null; assessedAt: string }
export interface QueueEntry { id: number; patientId: string; status: "triage" | "waiting" | "completed"; priority: number | null; enteredTick: number; enteredAt: string; exitedAt: string | null }
export interface Assignment { id: number; patientId: string; bayId: number | null; staffId: string | null; assignedAt: string; releasedAt: string | null }
export interface Notification { id: number; title: string; message: string; type: string; isRead: 0 | 1; createdAt: string }
