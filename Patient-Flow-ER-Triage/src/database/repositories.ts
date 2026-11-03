import type { Connection } from "./schema";
import type { Assessment, Assignment, Bay, DashboardMetrics, FlowEvent, Notification, Patient, QueueEntry, StaffMember } from "./models";

type PatientRow = Omit<Patient, "vitals"> & { vitals: string };
const patientQuery = `SELECT p.*, p.arrivalTs AS triageStartTs,
  (SELECT esi FROM TriageAssessments WHERE patientId = p.id ORDER BY id DESC LIMIT 1) AS esi,
  (SELECT enteredTick FROM PatientQueues WHERE patientId = p.id AND status = 'waiting' AND exitedAt IS NULL) AS waitStartTs,
  (SELECT bayId FROM PatientAssignments WHERE patientId = p.id AND bayId IS NOT NULL AND releasedAt IS NULL) AS bedId
  FROM Patients p`;
const staffQuery = `SELECT s.*, a.patientId AS assignedPatientId FROM Staff s
  LEFT JOIN PatientAssignments a ON a.staffId = s.id AND a.releasedAt IS NULL`;
const decodePatient = (row: PatientRow): Patient => ({ ...row, vitals: JSON.parse(row.vitals) });

function patientFields(patient: Patient) {
  return [patient.name ?? null, patient.age, patient.sex, patient.complaint, JSON.stringify(patient.vitals),
    patient.pain, patient.suggestedEsi, patient.status, patient.arrivalTs, patient.treatmentProgress];
}

/** Bound SQL for the local repositories. Workflows compose writes inside a transaction. */
export function repositories(db: Connection) {
  return {
    patients: {
      create: (patient: Patient) => db.runAsync(`INSERT INTO Patients
        (name,age,sex,complaint,vitals,pain,suggestedEsi,status,arrivalTs,treatmentProgress,id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [...patientFields(patient), patient.id]),
      all: async () => (await db.getAllAsync<PatientRow>(`${patientQuery} ORDER BY p.rowid`)).map(decodePatient),
      byId: async (id: string) => {
        const row = await db.getFirstAsync<PatientRow>(`${patientQuery} WHERE p.id = ?`, id);
        return row ? decodePatient(row) : null;
      },
      update: (patient: Patient) => db.runAsync(`UPDATE Patients SET name=?,age=?,sex=?,complaint=?,
        vitals=?,pain=?,suggestedEsi=?,status=?,arrivalTs=?,treatmentProgress=?,updatedAt=CURRENT_TIMESTAMP WHERE id=?`,
        [...patientFields(patient), patient.id]),
      delete: (id: string) => db.runAsync("DELETE FROM Patients WHERE id = ? AND status = 'triage'", id),
    },
    assessments: {
      create: (id: string, esi: number, notes: string | null = null, assessedBy: string | null = null) =>
        db.runAsync("INSERT INTO TriageAssessments(patientId,esi,notes,assessedBy) VALUES (?,?,?,?)", id, esi, notes, assessedBy),
      byPatient: (id: string) => db.getAllAsync<Assessment>("SELECT * FROM TriageAssessments WHERE patientId=? ORDER BY id DESC", id),
      latest: (id: string) => db.getFirstAsync<Assessment>("SELECT * FROM TriageAssessments WHERE patientId=? ORDER BY id DESC LIMIT 1", id),
    },
    queue: {
      add: (id: string, status: "triage" | "waiting", tick: number, priority: number | null = null) =>
        db.runAsync("INSERT INTO PatientQueues(patientId,status,enteredTick,priority) VALUES (?,?,?,?)", id, status, tick, priority),
      active: () => db.getAllAsync<QueueEntry>("SELECT * FROM PatientQueues WHERE exitedAt IS NULL ORDER BY priority, enteredTick, id"),
      update: (id: string, status: "triage" | "waiting", tick: number, priority: number | null) =>
        db.runAsync(`UPDATE PatientQueues SET status=?, enteredTick=?, priority=?, enteredAt=CURRENT_TIMESTAMP
          WHERE patientId=? AND exitedAt IS NULL`, status, tick, priority, id),
      complete: (id: string) => db.runAsync(`UPDATE PatientQueues SET status='completed', exitedAt=CURRENT_TIMESTAMP
        WHERE patientId=? AND exitedAt IS NULL`, id),
    },
    bays: {
      all: () => db.getAllAsync<Bay>("SELECT * FROM TreatmentBays ORDER BY id"),
      available: () => db.getAllAsync<Bay>("SELECT * FROM TreatmentBays WHERE status='available' ORDER BY id"),
      update: (id: number, status: Bay["status"]) =>
        db.runAsync(`UPDATE TreatmentBays SET status=?, occupancyStatus=CASE ? WHEN 'occupied' THEN 'Occupied' WHEN 'available' THEN 'Available' ELSE occupancyStatus END,
          updatedAt=CURRENT_TIMESTAMP WHERE id=?`, status, status, id),
    },
    staff: {
      all: () => db.getAllAsync<StaffMember>(`${staffQuery} ORDER BY s.id`),
      available: () => db.getAllAsync<StaffMember>(`${staffQuery} WHERE s.status='Idle' ORDER BY s.id`),
      update: (id: string, status: StaffMember["status"]) =>
        db.runAsync(`UPDATE Staff SET status=?, availability=CASE ? WHEN 'Busy' THEN 'Busy' WHEN 'Idle' THEN 'Available' ELSE availability END,
          updatedAt=CURRENT_TIMESTAMP WHERE id=?`, status, status, id),
    },
    assignments: {
      bay: (patientId: string, bayId: number) =>
        db.runAsync("INSERT INTO PatientAssignments(patientId,bayId) VALUES (?,?)", patientId, bayId),
      staff: (patientId: string, staffId: string) =>
        db.runAsync("INSERT INTO PatientAssignments(patientId,staffId) VALUES (?,?)", patientId, staffId),
      release: (id: number) => db.runAsync("UPDATE PatientAssignments SET releasedAt=CURRENT_TIMESTAMP WHERE id=? AND releasedAt IS NULL", id),
      active: () => db.getAllAsync<Assignment>("SELECT * FROM PatientAssignments WHERE releasedAt IS NULL ORDER BY id"),
    },
    events: {
      create: (event: FlowEvent) => db.runAsync(`INSERT INTO EventLogs(id,patientId,category,text,type,ts)
        VALUES (?,?,?,?,?,?)`, event.id, event.patientId ?? null, event.category, event.text, event.type, event.ts),
      recent: () => db.getAllAsync<FlowEvent>("SELECT * FROM EventLogs ORDER BY ts DESC, rowid DESC LIMIT 50"),
      byPatient: (id: string) => db.getAllAsync<FlowEvent>("SELECT * FROM EventLogs WHERE patientId=? ORDER BY ts DESC, rowid DESC", id),
    },
    notifications: {
      create: (title: string, message: string, type: string) =>
        db.runAsync("INSERT INTO Notifications(title,message,type) VALUES (?,?,?)", title, message, type),
      all: () => db.getAllAsync<Notification>("SELECT * FROM Notifications ORDER BY id DESC"),
      markRead: (id: number) => db.runAsync("UPDATE Notifications SET isRead=1 WHERE id=?", id),
    },
    dashboard: async (tick: number) => {
      const metrics = await db.getFirstAsync<DashboardMetrics>(`SELECT
        count(*) AS total, count(CASE WHEN status='waiting' THEN 1 END) AS waiting,
        count(CASE WHEN status='treatment' THEN 1 END) AS treatment,
        count(CASE WHEN status='discharged' THEN 1 END) AS discharged,
        (SELECT count(*) FROM TreatmentBays WHERE status='available') AS availableBays,
        (SELECT count(*) FROM TreatmentBays WHERE status='occupied') AS occupiedBays,
        (SELECT count(*) FROM Staff WHERE status='Idle') AS availableStaff,
        (SELECT coalesce(round(avg(max(0, ? - q.enteredTick))), 0) FROM PatientQueues q
          JOIN Patients p ON p.id=q.patientId WHERE q.status='waiting' AND p.status='waiting') AS averageWait
        FROM Patients`, tick);
      if (!metrics) throw new Error("Dashboard query returned no result");
      return metrics;
    },
  };
}
