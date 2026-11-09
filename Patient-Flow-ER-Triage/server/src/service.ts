import { randomUUID } from "node:crypto";
import { permit, type Actor, type Permission } from "./auth.js";
import { transaction, type Database } from "./db.js";
import { conflict, missing } from "./errors.js";
import { Repository, type Fields, type ListTable, type ListQuery } from "./repository.js";

const readGrants: Record<ListTable, Permission> = {
  patient_records: "records", encounters: "records", patient_queues: "read", treatment_bays: "read",
  staff: "records", resources: "records", event_logs: "records", audit_logs: "audit", notifications: "read",
};
const management = { treatment_bays: "manageBay", staff: "manageStaff", resources: "manageResource" } as const;
type Managed = keyof typeof management;

export function service(database: Database, actor: Actor) {
  const repo = new Repository(database);
  function write<T>(permission: Permission, work: (r: Repository) => T) {
    permit(actor, permission);
    return transaction(database, (db) => work(new Repository(db)));
  }
  const audit = (r: Repository, action: string, entity: string, id: string, details = {}) =>
    r.insert("audit_logs", { actor_id: actor.id, action, entity_type: entity, entity_id: id, details });
  const event = (r: Repository, id: string, category: string, message: string) =>
    r.insert("event_logs", { encounter_id: id, category, message, type: category === "Disposition" ? "success" : "info" });
  function encounter(r: Repository, patientId: string, complaint: unknown) {
    const row = r.insert("encounters", { patient_id: patientId, encounter_code: "ER-" + randomUUID(), chief_complaint: complaint });
    r.insert("patient_queues", { encounter_id: row.id, status: "triage" });
    event(r, row.id, "Registration", "Encounter registered for triage");
    audit(r, "CREATE", "EREncounter", row.id);
    return row;
  }
  function queue(r: Repository, id: string) {
    return r.activeQueue(id)[0] ?? conflict("Encounter has no active queue");
  }
  function release(r: Repository, assignment: Fields & { id: string }, now: Date) {
    const bay = assignment.bay_id as string | null;
    const staff = assignment.staff_id as string | null;
    const result = r.update("patient_assignments", assignment.id, { released_at: now });
    if (bay) r.update("treatment_bays", bay, { readiness: "Available" });
    if (staff) r.update("staff", staff, { availability: "Available" });
    return result;
  }

  return {
    list(table: ListTable, query: ListQuery, id?: string) {
      permit(actor, readGrants[table]);
      return transaction(database, (db) => {
        const reader = new Repository(db);
        if (table === "encounters" && id) reader.get("patient_records", id);
        return reader.list(table, query, table === "notifications" ? actor.id : id);
      }, true);
    },
    get(table: ListTable, id: string) {
      permit(actor, readGrants[table]);
      return repo.get(table, id);
    },
    details(id: string, query: ListQuery) {
      permit(actor, "records");
      return transaction(database, (db) => new Repository(db).patientDetails(id, query), true);
    },
    dashboard() {
      permit(actor, "read");
      const dashboard = transaction(database, (db) => new Repository(db).dashboard(), true);
      if (actor.role === "viewer") {
        dashboard.patients = dashboard.patients.map(({ id, status, arrival_at, queue_entered_at, esi, assessed_esi, bay_id }) =>
          ({ id, status, arrival_at, queue_entered_at, esi, assessed_esi, bay_id }));
        dashboard.events = [];
      }
      return dashboard;
    },
    register(input: Fields) {
      return write("register", (r) => {
        const { chief_complaint, ...data } = input;
        const patient = r.insert("patient_records", { patient_code: "MRN-" + randomUUID(), ...data });
        const visit = encounter(r, patient.id, chief_complaint);
        audit(r, "CREATE", "PatientRecord", patient.id);
        return { patient, encounter: visit };
      });
    },
    updatePatient(id: string, data: Fields) {
      return write("register", (r) => {
        if (r.get("patient_records", id).archived_at) missing();
        const result = r.update("patient_records", id, { ...data, updated_at: new Date() });
        audit(r, "UPDATE", "PatientRecord", id, { fields: Object.keys(data) });
        return result;
      });
    },
    returnPatient(id: string, complaint: string) {
      return write("register", (r) => {
        if (r.get("patient_records", id).archived_at) missing();
        return encounter(r, id, complaint);
      });
    },
    triage(id: string, data: Fields) {
      return write("triage", (r) => {
        if (r.get("encounters", id).status !== "triage") conflict("Encounter is no longer awaiting triage");
        const current = queue(r, id);
        const result = r.insert("triage_assessments", { ...data, encounter_id: id, assessed_by: actor.id });
        r.update("encounters", id, { status: "waiting" });
        r.update("patient_queues", current.id, { status: "waiting", priority: data.esi, entered_at: new Date() });
        event(r, id, "Triage", "Triage assessment recorded");
        audit(r, "TRIAGE", "EREncounter", id, { assessmentId: result.id });
        return result;
      });
    },
    prioritize(id: string, priority: number) {
      return write("triage", (r) => {
        const entry = r.get("patient_queues", id);
        const visit = r.get("encounters", entry.encounter_id);
        const current = queue(r, visit.id);
        if (visit.status !== "waiting" || current.id !== id) conflict("Only the active waiting queue can be reprioritized");
        const result = r.update("patient_queues", id, { priority });
        audit(r, "REPRIORITIZE", "PatientQueue", id, { priority });
        event(r, visit.id, "Queue", "Waiting priority updated");
        return result;
      });
    },
    assignBay(id: string, bayId: string) {
      return write("allocate", (r) => {
        if (r.get("encounters", id).status !== "waiting") conflict("Encounter is not waiting for treatment");
        const entry = queue(r, id);
        const bay = r.get("treatment_bays", bayId);
        if (bay.operational_status !== "Active" || bay.readiness !== "Available") conflict("Bay is unavailable");
        const result = r.insert("patient_assignments", { encounter_id: id, bay_id: bayId });
        r.update("treatment_bays", bayId, { readiness: "Reserved" });
        r.update("patient_queues", entry.id, { status: "completed", exited_at: new Date() });
        r.update("encounters", id, { status: "treatment", treatment_priority: entry.priority });
        event(r, id, "Bay assignment", "Encounter moved to treatment");
        audit(r, "ASSIGN", "TreatmentBay", bayId, { assignmentId: result.id });
        return result;
      });
    },
    assignStaff(id: string, staffId: string) {
      return write("allocate", (r) => {
        if (r.get("encounters", id).status !== "treatment") conflict("Encounter is not under treatment");
        const staff = r.get("staff", staffId);
        if (staff.employment_status !== "Active" || staff.availability !== "Available") conflict("Staff member is unavailable");
        const result = r.insert("patient_assignments", { encounter_id: id, staff_id: staffId });
        r.update("staff", staffId, { availability: "Busy" });
        event(r, id, "Staff assignment", "Staff responsibility assigned");
        audit(r, "ASSIGN", "Staff", staffId, { assignmentId: result.id });
        return result;
      });
    },
    releaseAssignment(id: string) {
      return write("allocate", (r) => {
        const current = r.get("patient_assignments", id);
        const visit = r.get("encounters", current.encounter_id);
        if (current.released_at) conflict("Assignment has already been released");
        const result = release(r, current, new Date());
        if (current.bay_id) {
          const assignments = r.activeAssignments("encounter_id", visit.id);
          for (const assignment of assignments) release(r, assignment, new Date());
          r.update("encounters", visit.id, { status: "waiting" });
          r.insert("patient_queues", { encounter_id: visit.id, status: "waiting", priority: visit.treatment_priority });
        }
        event(r, visit.id, "Assignment release", "Assignment released");
        audit(r, "RELEASE", "PatientAssignment", id);
        return result;
      });
    },
    discharge(id: string, disposition: "discharged" | "admitted") {
      return write("allocate", (r) => {
        if (r.get("encounters", id).status !== "treatment") conflict("Encounter is not under treatment");
        const now = new Date();
        for (const assignment of r.activeAssignments("encounter_id", id)) release(r, assignment, now);
        const result = r.update("encounters", id, { status: disposition, discharged_at: now });
        event(r, id, "Disposition", "Treatment completed");
        audit(r, "DISPOSITION", "EREncounter", id, { disposition });
        return result;
      });
    },
    save(table: Managed, id: string | undefined, data: Fields, reason?: string) {
      return write(management[table], (r) => {
        const previous = id ? r.get(table, id) : undefined;
        const next = { ...previous, ...data };
        if (table === "staff" && id && r.activeAssignments("staff_id", id).length &&
            (next.employment_status !== "Active" || next.availability !== "Busy")) conflict("Staff member has active responsibilities");
        if (table === "treatment_bays") {
          const occupied = id && r.activeAssignments("bay_id", id).length > 0;
          if (occupied && (next.operational_status !== "Active" || ("readiness" in data && next.readiness !== "Occupied"))) {
            conflict("Bay has an active assignment");
          }
          if (data.readiness === "Occupied") {
            if (!occupied) conflict("Occupancy requires an active assignment");
            data = { ...data, readiness: previous.readiness };
          }
        }
        if (table === "resources" && next.quantity_available > next.quantity_total) conflict("Available inventory exceeds capacity");
        if (!Object.keys(data).length) conflict("At least one record field is required");
        if (table === "resources" && id) data = { ...data, updated_at: new Date() };
        const result = id ? r.update(table, id, data) : r.insert(table, data);
        if (table === "resources") {
          r.insert("resource_transactions", {
            resource_id: result.id, quantity_delta: result.quantity_available - (previous?.quantity_available ?? 0),
            reason: reason ?? "Administrative adjustment", actor_id: actor.id,
          });
        }
        audit(r, id ? "UPDATE" : "CREATE", table, result.id, { fields: Object.keys(data) });
        return result;
      });
    },
    adjust(id: string, delta: number, reason: string) {
      return write("manageResource", (r) => {
        const row = r.get("resources", id);
        const quantity = row.quantity_available + delta;
        if (quantity < 0 || quantity > row.quantity_total) conflict("Adjustment exceeds inventory bounds");
        const result = r.update("resources", id, { quantity_available: quantity, updated_at: new Date() });
        const adjustment = r.insert("resource_transactions", {
          resource_id: id, quantity_delta: delta, reason, actor_id: actor.id,
        });
        audit(r, "ADJUST", "Resource", id, { transactionId: adjustment.id, delta });
        return result;
      });
    },
    readNotification(id: string) {
      return write("read", (r) => {
        const row = r.get("notifications", id);
        if (row.recipient_id !== actor.id) missing();
        return row.read_at ? row : r.update("notifications", id, { read_at: new Date() });
      });
    },
  };
}
