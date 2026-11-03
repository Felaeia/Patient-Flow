import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import { connect, transaction } from "./db.js";
import { Repository } from "./repository.js";

type Row = Record<string, any>;
const timestamp = (value: string | null) => value && (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)
  ? value.replace(" ", "T") + "Z" : value);

export async function importSqlite(pool: Pool, path: string, notificationRecipient: string) {
  if (!notificationRecipient.trim()) throw new Error("A recipient for legacy notifications is required");
  const source = new DatabaseSync(path, { readOnly: true });
  const read = (table: string) => source.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Row[];
  try {
    source.exec("BEGIN");
    if (source.prepare("PRAGMA user_version").get()?.user_version !== 2) throw new Error("Expected a migrated TriFlow SQLite v2 snapshot");
    return await transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(198274236)");
      await db.query(`LOCK TABLE patient_records, encounters, patient_queues, treatment_bays, staff, resources, patient_assignments,
        triage_assessments, resource_transactions, event_logs, audit_logs, notifications IN ACCESS EXCLUSIVE MODE`);
      const { rows: [state] } = await db.query(`SELECT EXISTS (SELECT 1 FROM patient_records UNION ALL SELECT 1 FROM encounters
        UNION ALL SELECT 1 FROM treatment_bays UNION ALL SELECT 1 FROM staff UNION ALL SELECT 1 FROM resources
        UNION ALL SELECT 1 FROM event_logs UNION ALL SELECT 1 FROM audit_logs UNION ALL SELECT 1 FROM notifications) AS populated`);
      if (state.populated) throw new Error("SQLite import requires an empty migrated destination");
      const repo = new Repository(db);
      const patients = new Map<number, string>();
      const encounters = new Map<string, string>();
      const staff = new Map<string, string>();
      const bays = new Map<number, string>();
      const resources = new Map<number, string>();
      const operational = new Map(read("Patients").map((row) => [row.id, row]));
      const priority = new Map<string, number>();
      for (const row of read("PatientQueues")) if (row.priority != null) priority.set(row.patientId, row.priority);
      for (const row of read("TriageAssessments")) if (!priority.has(row.patientId)) priority.set(row.patientId, row.esi);

      for (const row of read("PatientRecords")) {
        const record = await repo.insert("patient_records", {
          patient_code: row.patientCode, first_name: row.firstName, middle_name: row.middleName,
          last_name: row.lastName, date_of_birth: row.dateOfBirth || null, sex: row.sex,
          contact_number: row.contactNumber, emergency_contact: row.emergencyContact, legacy_unidentified: !!row.isUnidentified,
          archived_at: timestamp(row.archivedAt), created_at: timestamp(row.createdAt), updated_at: timestamp(row.updatedAt),
        });
        patients.set(row.id, record.id);
      }
      async function visit(patientId: string | undefined, row: Row, legacy?: Row) {
        const status = legacy?.status ?? row.status;
        const record = await repo.insert("encounters", {
          patient_id: patientId, encounter_code: row.encounterCode, chief_complaint: row.chiefComplaint,
          arrival_at: timestamp(row.arrivalAt), archived_at: timestamp(row.archivedAt ?? null), status,
          discharged_at: ["discharged", "admitted"].includes(status) ? timestamp(legacy?.updatedAt ?? row.updatedAt) : null,
          legacy_operational_id: legacy?.id ?? null, vitals: legacy ? JSON.parse(legacy.vitals) : null,
          pain: legacy?.pain ?? null, suggested_esi: legacy?.suggestedEsi ?? null,
          treatment_priority: legacy ? priority.get(legacy.id) ?? null : null,
        });
        if (legacy) encounters.set(legacy.id, record.id);
      }
      for (const row of read("EREncounters")) await visit(patients.get(row.patientRecordId), row, operational.get(row.operationalPatientId));
      for (const row of operational.values()) {
        if (encounters.has(row.id)) continue;
        const record = await repo.insert("patient_records", {
          patient_code: "SIM-" + row.id, first_name: row.name, sex: row.sex,
          created_at: timestamp(row.createdAt), updated_at: timestamp(row.updatedAt),
        });
        await visit(record.id, { encounterCode: "SIM-" + row.id, chiefComplaint: row.complaint, arrivalAt: row.createdAt }, row);
      }

      for (const row of read("TreatmentBays")) {
        const record = await repo.insert("treatment_bays", {
          code: row.code, name: row.name, type: row.type, location: row.location, operational_status: row.operationalStatus,
          readiness: row.occupancyStatus === "Occupied" ? "Reserved" : row.occupancyStatus, created_at: timestamp(row.createdAt),
        });
        bays.set(row.id, record.id);
      }
      for (const row of read("Staff")) {
        const record = await repo.insert("staff", {
          legacy_id: row.id, employee_code: row.employeeCode, first_name: row.firstName ?? row.name, last_name: row.lastName ?? "",
          clinical_role: row.role, department: row.department, shift: row.shift, employment_status: row.employmentStatus,
          availability: row.status === "Busy" ? "Busy" : row.availability, created_at: timestamp(row.createdAt),
        });
        staff.set(row.id, record.id);
      }
      for (const row of read("Resources")) {
        const record = await repo.insert("resources", {
          code: row.code, name: row.name, category: row.category, kind: row.kind, quantity_total: row.quantityTotal,
          quantity_available: row.quantityAvailable, unit: row.unit, location: row.location, status: row.status,
          created_at: timestamp(row.createdAt), updated_at: timestamp(row.updatedAt), archived_at: timestamp(row.archivedAt),
        });
        resources.set(row.id, record.id);
      }
      for (const row of read("PatientQueues")) await repo.insert("patient_queues", {
        encounter_id: encounters.get(row.patientId), status: row.status, priority: row.priority,
        entered_at: timestamp(row.enteredAt), exited_at: timestamp(row.exitedAt),
      });
      for (const row of read("PatientAssignments")) await repo.insert("patient_assignments", {
        encounter_id: encounters.get(row.patientId), bay_id: bays.get(row.bayId) ?? null, staff_id: staff.get(row.staffId) ?? null,
        assigned_at: timestamp(row.assignedAt), released_at: timestamp(row.releasedAt),
      });
      for (const row of read("TriageAssessments")) await repo.insert("triage_assessments", {
        encounter_id: encounters.get(row.patientId), esi: row.esi, notes: row.notes,
        assessed_by: row.assessedBy ?? "legacy-unknown", created_at: timestamp(row.assessedAt),
      });
      for (const row of read("ResourceTransactions")) await repo.insert("resource_transactions", {
        resource_id: resources.get(row.resourceId), quantity_delta: row.quantityDelta, reason: row.reason,
        actor_id: row.actorId, created_at: timestamp(row.createdAt),
      });
      for (const row of read("EventLogs")) await repo.insert("event_logs", {
        legacy_id: row.id, encounter_id: encounters.get(row.patientId) ?? null, category: row.category,
        message: row.text, type: row.type, created_at: timestamp(row.createdAt),
      });
      for (const row of read("AuditLogs")) await repo.insert("audit_logs", {
        actor_id: row.actorId, action: row.action, entity_type: row.entityType, entity_id: row.entityId,
        details: { source: "sqlite", legacyId: row.id, original: JSON.parse(row.details) }, created_at: timestamp(row.createdAt),
      });
      for (const row of read("Notifications")) await repo.insert("notifications", {
        recipient_id: notificationRecipient, title: row.title, message: row.message, type: row.type,
        read_at: row.isRead ? timestamp(row.createdAt) : null, created_at: timestamp(row.createdAt),
      });
      return { patients: patients.size, operationalEncounters: encounters.size };
    });
  } finally {
    source.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { DATABASE_URL, LEGACY_NOTIFICATION_RECIPIENT } = process.env;
  const path = process.argv[2];
  if (!DATABASE_URL || !path || !LEGACY_NOTIFICATION_RECIPIENT) {
    throw new Error("Set DATABASE_URL and LEGACY_NOTIFICATION_RECIPIENT and provide the SQLite snapshot path");
  }
  const pool = connect(DATABASE_URL);
  try { console.log(await importSqlite(pool, path, LEGACY_NOTIFICATION_RECIPIENT)); }
  catch { console.error("Import failed. The PostgreSQL transaction was rolled back."); process.exitCode = 1; }
  finally { await pool.end(); }
}
