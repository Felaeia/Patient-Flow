import type { AdminActor, AdminBay, AdminStaff, PatientRecord, ResourceRecord } from "./models";
import type { Connection } from "./schema";
import type { SQLiteBindValue } from "expo-sqlite";
import { transaction } from "./schema";
import { requirePermission, type Permission } from "../auth/permissions";

export interface Page<T> { rows: T[]; total: number; page: number; pageSize: number }
export interface PatientInput { patientCode?: string; firstName?: string; middleName?: string; lastName?: string; dateOfBirth?: string; sex: string; contactNumber?: string; emergencyContact?: string; chiefComplaint: string }
export type BayInput = Pick<AdminBay, "code" | "name" | "type" | "location" | "operationalStatus" | "occupancyStatus">;
export type StaffInput = Pick<AdminStaff, "employeeCode" | "firstName" | "lastName" | "role" | "department" | "shift" | "availability" | "employmentStatus">;
export type ResourceInput = Pick<ResourceRecord, "code" | "name" | "category" | "kind" | "quantityTotal" | "quantityAvailable" | "unit" | "location" | "status">;

const clean = (value?: string) => value?.trim() || null;
const token = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Administrative commands enforce permissions, constraints, auditing, and transactional workflows. */
export function createAdminService(db: Connection, actor: AdminActor) {
  const permit = (permission: Permission) => requirePermission(actor, permission);
  const audit = (action: string, entityType: string, entityId: string, details: object) =>
    db.runAsync("INSERT INTO AuditLogs(actorId,action,entityType,entityId,details) VALUES (?,?,?,?,?)",
      actor.id, action, entityType, entityId, JSON.stringify(details));
  async function paged<T>(select: string, count: string, params: SQLiteBindValue[], page: number, pageSize: number): Promise<Page<T>> {
    const safePage = Math.max(1, page);
    const safeSize = Math.min(50, Math.max(1, pageSize));
    const total = (await db.getFirstAsync<{ total: number }>(count, params))?.total ?? 0;
    const rows = await db.getAllAsync<T>(`${select} LIMIT ? OFFSET ?`, [...params, safeSize, (safePage - 1) * safeSize]);
    return { rows, total, page: safePage, pageSize: safeSize };
  }

  return {
    patients: {
      list(search = "", status = "", page = 1, pageSize = 10) {
        permit("admin:view");
        const like = `%${search.trim()}%`;
        const where = `WHERE r.archivedAt IS NULL AND (?='' OR r.patientCode LIKE ? OR coalesce(r.firstName,'') || ' ' || coalesce(r.lastName,'') LIKE ?)
          AND (?='' OR e.status=?)`;
        const params = [search.trim(), like, like, status, status];
        const from = `FROM PatientRecords r LEFT JOIN EREncounters e ON e.id=(SELECT id FROM EREncounters WHERE patientRecordId=r.id ORDER BY arrivalAt DESC,id DESC LIMIT 1)`;
        return paged<PatientRecord>(`SELECT r.*, count(allE.id) AS encounterCount, e.status AS currentStatus ${from} LEFT JOIN EREncounters allE ON allE.patientRecordId=r.id ${where} GROUP BY r.id ORDER BY r.updatedAt DESC`,
          `SELECT count(DISTINCT r.id) AS total ${from} ${where}`, params, page, pageSize);
      },
      details(id: number) {
        permit("admin:view");
        return Promise.all([
          db.getFirstAsync<PatientRecord>("SELECT * FROM PatientRecords WHERE id=?", id),
          db.getAllAsync("SELECT * FROM EREncounters WHERE patientRecordId=? ORDER BY arrivalAt DESC,id DESC", id),
          db.getAllAsync(`SELECT a.*, e.encounterCode FROM TriageAssessments a JOIN EREncounters e ON e.operationalPatientId=a.patientId WHERE e.patientRecordId=? ORDER BY a.id DESC`, id),
          db.getAllAsync(`SELECT l.* FROM EventLogs l JOIN EREncounters e ON e.operationalPatientId=l.patientId WHERE e.patientRecordId=? ORDER BY l.ts DESC`, id),
          db.getAllAsync(`SELECT a.*,b.name AS bayName,s.name AS staffName FROM PatientAssignments a
            JOIN EREncounters e ON e.operationalPatientId=a.patientId LEFT JOIN TreatmentBays b ON b.id=a.bayId LEFT JOIN Staff s ON s.id=a.staffId
            WHERE e.patientRecordId=? ORDER BY a.id DESC`, id),
        ]);
      },
      create(input: PatientInput) {
        permit("patients:write");
        return transaction(db, async () => {
          if (!input.sex.trim() || !input.chiefComplaint.trim()) throw new Error("Sex and chief complaint are required");
          const suffix = token();
          const patientCode = input.patientCode?.trim() || `MRN-${suffix}`;
          const operationalId = `P-${suffix}`;
          const encounterCode = `ER-${suffix}`;
          const unidentified = !clean(input.firstName) && !clean(input.lastName) ? 1 : 0;
          const record = await db.runAsync(`INSERT INTO PatientRecords(patientCode,firstName,middleName,lastName,dateOfBirth,sex,contactNumber,emergencyContact,isUnidentified)
            VALUES (?,?,?,?,?,?,?,?,?)`, patientCode, clean(input.firstName), clean(input.middleName), clean(input.lastName), clean(input.dateOfBirth), input.sex.trim(), clean(input.contactNumber), clean(input.emergencyContact), unidentified);
          const recordId = Number(record.lastInsertRowId);
          const state = await db.getFirstAsync<{ tick: number }>("SELECT tick FROM SimulationState WHERE id=1");
          const tick = state?.tick ?? 0;
          const displayName = [input.firstName, input.middleName, input.lastName].filter(Boolean).join(" ") || "Unidentified Patient";
          await db.runAsync(`INSERT INTO Patients(id,name,age,sex,complaint,vitals,pain,suggestedEsi,status,arrivalTs,treatmentProgress)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`, operationalId, displayName, 0, input.sex.trim(), input.chiefComplaint.trim(), JSON.stringify({ hr: 0, bpSys: 0, bpDia: 0, spo2: 0, temp: 0 }), 0, 3, "triage", tick, 0);
          await db.runAsync("INSERT INTO EREncounters(encounterCode,patientRecordId,operationalPatientId,arrivalAt,chiefComplaint,status) VALUES (?,?,?,CURRENT_TIMESTAMP,?,'triage')",
            encounterCode, recordId, operationalId, input.chiefComplaint.trim());
          await db.runAsync("INSERT INTO PatientQueues(patientId,status,enteredTick) VALUES (?,'triage',?)", operationalId, tick);
          await db.runAsync("INSERT INTO EventLogs(id,patientId,category,text,type,ts) VALUES (?,?,?,?,?,?)",
            `${operationalId}:Registration:${tick}`, operationalId, "Registration", `${operationalId} registered for triage`, "info", tick);
          await audit("CREATE", "PatientRecord", String(recordId), { patientCode, encounterCode });
          return recordId;
        });
      },
      createEncounter(patientRecordId: number, chiefComplaint: string) {
        permit("patients:write");
        return transaction(db, async () => {
          if (!chiefComplaint.trim()) throw new Error("Chief complaint is required");
          const record = await db.getFirstAsync<PatientRecord>("SELECT * FROM PatientRecords WHERE id=? AND archivedAt IS NULL", patientRecordId);
          if (!record) throw new Error("Patient record was not found");
          const suffix = token();
          const operationalId = `P-${suffix}`;
          const encounterCode = `ER-${suffix}`;
          const state = await db.getFirstAsync<{ tick: number }>("SELECT tick FROM SimulationState WHERE id=1");
          const tick = state?.tick ?? 0;
          const displayName = [record.firstName, record.middleName, record.lastName].filter(Boolean).join(" ") || "Unidentified Patient";
          await db.runAsync(`INSERT INTO Patients(id,name,age,sex,complaint,vitals,pain,suggestedEsi,status,arrivalTs,treatmentProgress)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`, operationalId, displayName, 0, record.sex, chiefComplaint.trim(), JSON.stringify({ hr: 0, bpSys: 0, bpDia: 0, spo2: 0, temp: 0 }), 0, 3, "triage", tick, 0);
          await db.runAsync("INSERT INTO EREncounters(encounterCode,patientRecordId,operationalPatientId,arrivalAt,chiefComplaint,status) VALUES (?,?,?,CURRENT_TIMESTAMP,?,'triage')",
            encounterCode, patientRecordId, operationalId, chiefComplaint.trim());
          await db.runAsync("INSERT INTO PatientQueues(patientId,status,enteredTick) VALUES (?,'triage',?)", operationalId, tick);
          await db.runAsync("INSERT INTO EventLogs(id,patientId,category,text,type,ts) VALUES (?,?,?,?,?,?)",
            `${operationalId}:Registration:${tick}`, operationalId, "Registration", `${operationalId} registered for triage`, "info", tick);
          await audit("CREATE", "EREncounter", encounterCode, { patientRecordId, chiefComplaint });
        });
      },
      update(id: number, input: Omit<PatientInput, "chiefComplaint">) {
        permit("patients:write");
        return transaction(db, async () => {
          const result = await db.runAsync(`UPDATE PatientRecords SET patientCode=?,firstName=?,middleName=?,lastName=?,dateOfBirth=?,sex=?,contactNumber=?,emergencyContact=?,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND archivedAt IS NULL`,
            input.patientCode?.trim() ?? "", clean(input.firstName), clean(input.middleName), clean(input.lastName), clean(input.dateOfBirth), input.sex.trim(), clean(input.contactNumber), clean(input.emergencyContact), id);
          if (!result.changes) throw new Error("Patient record was not found");
          await audit("UPDATE", "PatientRecord", String(id), input);
        });
      },
    },
    bays: {
      async counts() {
        permit("admin:view");
        return db.getFirstAsync<{ available: number; occupied: number }>(`SELECT count(CASE WHEN status='available' THEN 1 END) available,
          count(CASE WHEN status='occupied' THEN 1 END) occupied FROM TreatmentBays`);
      },
      list(search = "", status = "", page = 1, pageSize = 10) {
        permit("admin:view"); const like = `%${search}%`; const where = "WHERE (?='' OR code LIKE ? OR name LIKE ?) AND (?='' OR operationalStatus=?)";
        const params = [search, like, like, status, status];
        return paged<AdminBay>(`SELECT * FROM TreatmentBays ${where} ORDER BY id`, `SELECT count(*) total FROM TreatmentBays ${where}`, params, page, pageSize);
      },
      save(id: number | null, input: BayInput) {
        permit("bays:write");
        return transaction(db, async () => {
          if (id) {
            const active = (await db.getFirstAsync<{ total: number }>("SELECT count(*) total FROM PatientAssignments WHERE bayId=? AND releasedAt IS NULL", id))?.total ?? 0;
            if (active && input.operationalStatus !== "Active") throw new Error("Transfer the active patient before deactivating this bay");
            const assignment = (await db.getFirstAsync<{ total: number }>("SELECT count(*) total FROM PatientAssignments WHERE bayId=? AND releasedAt IS NULL", id))?.total ?? 0;
            if (input.occupancyStatus === "Occupied" && !assignment) throw new Error("Bay occupancy must come from an active patient assignment");
            if (assignment && input.occupancyStatus !== "Occupied") throw new Error("Release or transfer the patient before changing occupancy");
            await db.runAsync(`UPDATE TreatmentBays SET code=?,name=?,type=?,location=?,operationalStatus=?,occupancyStatus=?,status=?,updatedAt=CURRENT_TIMESTAMP WHERE id=?`,
              input.code, input.name, input.type, input.location, input.operationalStatus, input.occupancyStatus,
              input.operationalStatus === "Active" && input.occupancyStatus === "Available" ? "available" : input.occupancyStatus === "Occupied" ? "occupied" : "unavailable", id);
          } else {
            const result = await db.runAsync(`INSERT INTO TreatmentBays(code,name,type,location,operationalStatus,occupancyStatus,status,createdAt) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
              input.code, input.name, input.type, input.location, input.operationalStatus, input.occupancyStatus, input.operationalStatus === "Active" ? "available" : "unavailable");
            id = Number(result.lastInsertRowId);
          }
          await audit(id ? "UPSERT" : "CREATE", "TreatmentBay", String(id), input);
        });
      },
    },
    staff: {
      list(search = "", status = "", page = 1, pageSize = 10) {
        permit("admin:view"); const like = `%${search}%`; const where = "WHERE (?='' OR employeeCode LIKE ? OR name LIKE ?) AND (?='' OR employmentStatus=? OR role=? OR availability=?)";
        const params = [search, like, like, status, status, status, status];
        return paged<AdminStaff>(`SELECT s.*,a.patientId assignedPatientId FROM Staff s LEFT JOIN PatientAssignments a ON a.staffId=s.id AND a.releasedAt IS NULL ${where} ORDER BY s.id`, `SELECT count(*) total FROM Staff s ${where}`, params, page, pageSize);
      },
      save(id: string | null, input: StaffInput) {
        permit("staff:write");
        return transaction(db, async () => {
          const name = `${input.firstName ?? ""} ${input.lastName ?? ""}`.trim();
          if (id) {
            const active = (await db.getFirstAsync<{ total: number }>("SELECT count(*) total FROM PatientAssignments WHERE staffId=? AND releasedAt IS NULL", id))?.total ?? 0;
            if (active && input.employmentStatus === "Inactive") throw new Error("Reassign active responsibilities before deactivation");
            const internalStatus = input.availability === "Busy" ? "Busy" : input.availability === "Available" ? "Idle" : "Unavailable";
            await db.runAsync(`UPDATE Staff SET employeeCode=?,firstName=?,lastName=?,name=?,role=?,department=?,shift=?,status=?,availability=?,employmentStatus=?,updatedAt=CURRENT_TIMESTAMP WHERE id=?`,
              input.employeeCode, clean(input.firstName ?? undefined), clean(input.lastName ?? undefined), name, input.role, input.department, input.shift, internalStatus, input.availability, input.employmentStatus, id);
          } else {
            id = `staff-${token()}`;
            const internalStatus = input.availability === "Busy" ? "Busy" : input.availability === "Available" ? "Idle" : "Unavailable";
            await db.runAsync(`INSERT INTO Staff(id,employeeCode,firstName,lastName,name,role,department,shift,status,availability,employmentStatus,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
              id, input.employeeCode, clean(input.firstName ?? undefined), clean(input.lastName ?? undefined), name, input.role, input.department, input.shift, internalStatus, input.availability, input.employmentStatus);
          }
          await audit("UPSERT", "Staff", id, input);
        });
      },
    },
    resources: {
      list(search = "", status = "", page = 1, pageSize = 10) {
        permit("admin:view"); const like = `%${search}%`; const where = "WHERE archivedAt IS NULL AND (?='' OR code LIKE ? OR name LIKE ?) AND (?='' OR status=? OR category=?)";
        const params = [search, like, like, status, status, status];
        return paged<ResourceRecord>(`SELECT * FROM Resources ${where} ORDER BY id DESC`, `SELECT count(*) total FROM Resources ${where}`, params, page, pageSize);
      },
      save(id: number | null, input: ResourceInput, reason: string) {
        permit("resources:write");
        return transaction(db, async () => {
          if (input.quantityAvailable < 0 || input.quantityAvailable > input.quantityTotal) throw new Error("Available quantity must be between zero and total quantity");
          let delta = input.quantityAvailable;
          if (id) {
            const current = await db.getFirstAsync<ResourceRecord>("SELECT * FROM Resources WHERE id=?", id);
            if (!current) throw new Error("Resource was not found");
            delta -= current.quantityAvailable;
            await db.runAsync(`UPDATE Resources SET code=?,name=?,category=?,kind=?,quantityTotal=?,quantityAvailable=?,unit=?,location=?,status=?,updatedAt=CURRENT_TIMESTAMP WHERE id=?`,
              input.code, input.name, input.category, input.kind, input.quantityTotal, input.quantityAvailable, input.unit, input.location, input.status, id);
          } else {
            const result = await db.runAsync(`INSERT INTO Resources(code,name,category,kind,quantityTotal,quantityAvailable,unit,location,status) VALUES (?,?,?,?,?,?,?,?,?)`,
              input.code, input.name, input.category, input.kind, input.quantityTotal, input.quantityAvailable, input.unit, input.location, input.status);
            id = Number(result.lastInsertRowId);
          }
          await db.runAsync("INSERT INTO ResourceTransactions(resourceId,quantityDelta,reason,actorId) VALUES (?,?,?,?)", id, delta, reason || "Administrative adjustment", actor.id);
          await audit("UPSERT", "Resource", String(id), { ...input, reason });
        });
      },
    },
  };
}
