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

export type AdminRole = "admin" | "registration" | "clinical" | "viewer";
export interface AdminActor { id: string; role: AdminRole }
export interface PatientRecord {
  id: number; patientCode: string; firstName: string | null; middleName: string | null;
  lastName: string | null; dateOfBirth: string | null; sex: string; contactNumber: string | null;
  emergencyContact: string | null; isUnidentified: 0 | 1; archivedAt: string | null; createdAt: string; updatedAt: string;
  encounterCount?: number; currentStatus?: string | null;
}
export interface AdminBay extends Bay {
  code: string; type: string; location: string; operationalStatus: "Active" | "Maintenance" | "Out of Service";
  occupancyStatus: "Available" | "Occupied" | "Reserved" | "Cleaning"; createdAt: string;
}
export interface AdminStaff extends StaffMember {
  employeeCode: string; firstName: string | null; lastName: string | null; department: string; shift: string;
  employmentStatus: "Active" | "Inactive"; availability: "Available" | "Busy" | "On Break" | "Off Duty"; createdAt: string;
}
export interface ResourceRecord {
  id: number; code: string; name: string; category: string; kind: "Consumable" | "Reusable";
  quantityTotal: number; quantityAvailable: number; unit: string; location: string;
  status: "Available" | "In Use" | "Maintenance" | "Unavailable"; archivedAt: string | null;
  createdAt: string; updatedAt: string;
}
